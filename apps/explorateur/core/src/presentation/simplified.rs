//! Repli : rendu simplifié d'un `.pptx` en Rust (images et texte positionnés, fond uni).

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use zip::ZipArchive;

use super::sheet::{DEFAULT_HEIGHT, DEFAULT_WIDTH, sheet};
use super::slide::{Ev, Item, Para, Rect, Slide, parse_slide, relations, tokenize};
use crate::{AppError, Result};

type Archive = ZipArchive<BufReader<File>>;

/// EMU par px CSS (914 400 EMU par pouce, 72 px par pouce dans ce rendu : 12 700).
const EMU_PER_PX: f64 = 12_700.0;
/// Une partie XML ou une image de plus de 50 Mio décompressés est ignorée.
const MAX_PART_BYTES: u64 = 50 * 1024 * 1024;
/// L'extraction des images s'arrête à 200 Mio au total.
const MAX_TOTAL_BYTES: u64 = 200 * 1024 * 1024;
const DEFAULT_FONT_PT: f64 = 18.0;
const IMAGE_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"];

/// Rend `path` dans `out_dir` : `Preview.html` (feuille commune comprise) et `media/`. Rend le
/// nombre de diapositives.
pub fn render_simplified(path: &Path, out_dir: &Path) -> Result<u32> {
    let shown = path.to_string_lossy();
    let file = File::open(path).map_err(|e| AppError::from_io(&e, &shown))?;
    let mut archive = ZipArchive::new(BufReader::new(file)).map_err(|_| AppError::Unreadable)?;

    let presentation =
        read_part(&mut archive, "ppt/presentation.xml").ok_or(AppError::Unreadable)?;
    let events = tokenize(&presentation).ok_or(AppError::Unreadable)?;
    let (width, height) = slide_size(&events);
    let order = slide_ids(&events);
    let rels = read_part(&mut archive, "ppt/_rels/presentation.xml.rels")
        .map(|x| relations(&x))
        .unwrap_or_default();

    let media_dir = out_dir.join("media");
    fs::create_dir_all(&media_dir)
        .map_err(|e| AppError::from_io(&e, &media_dir.to_string_lossy()))?;
    let mut media = Media::new(&mut archive, media_dir);

    let mut body = String::new();
    let mut count: u32 = 0;
    for rid in &order {
        let slide = rels
            .get(rid)
            .map(|target| resolve("ppt", target))
            .map(|part| load_slide(&mut media, &part))
            .unwrap_or_default();
        render_slide(&mut body, &slide, width, height, &mut media);
        count += 1;
    }

    let html = format!(
        "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"><style>\
         html,body{{margin:0}}\
         div.slide{{position:relative;overflow:hidden;width:{width}px;height:{height}px;\
         margin:5px 8px 0;background:#fff;font-family:Arial,sans-serif;\
         box-shadow:5px 5px 5px rgba(0,0,0,.5)}}\
         div.slide:first-of-type{{margin-top:0}}\
         div.slide p{{margin:0;white-space:pre-wrap;overflow-wrap:break-word}}\
         </style>{}</head><body>\n{body}</body></html>\n",
        sheet(width)
    );
    let out = out_dir.join("Preview.html");
    fs::write(&out, html).map_err(|e| AppError::from_io(&e, &out.to_string_lossy()))?;
    Ok(count)
}

/// Lit une partie XML de l'archive (50 Mio au plus).
fn read_part(archive: &mut Archive, name: &str) -> Option<Vec<u8>> {
    let file = archive.by_name(name).ok()?;
    let mut buf = Vec::new();
    file.take(MAX_PART_BYTES + 1).read_to_end(&mut buf).ok()?;
    (buf.len() as u64 <= MAX_PART_BYTES).then_some(buf)
}

/// Taille de diapo en px CSS d'après `p:sldSz` ; 960 × 540 si elle manque.
fn slide_size(events: &[Ev]) -> (u32, u32) {
    for ev in events {
        if let Ev::Open(t) = ev
            && t.name == "sldSz"
        {
            let emu = |key: &str| t.attr(key).and_then(|v| v.trim().parse::<f64>().ok());
            if let (Some(cx), Some(cy)) = (emu("cx"), emu("cy"))
                && cx >= EMU_PER_PX
                && cy >= EMU_PER_PX
            {
                return (
                    (cx / EMU_PER_PX).round() as u32,
                    (cy / EMU_PER_PX).round() as u32,
                );
            }
        }
    }
    (DEFAULT_WIDTH, DEFAULT_HEIGHT)
}

/// Identifiants de relation des diapos, dans l'ordre de `p:sldIdLst`.
fn slide_ids(events: &[Ev]) -> Vec<String> {
    events
        .iter()
        .filter_map(|ev| match ev {
            Ev::Open(t) if t.name == "sldId" => t.attr("r:id").map(str::to_owned),
            _ => None,
        })
        .collect()
}

/// Chemin d'une cible de relation, relatif au dossier `base` de la partie qui la porte, dans la
/// forme où l'archive la nomme. Les `..` qui sortent de la racine sont gardés (un nom piégé
/// ne correspond alors qu'à une entrée de même nom, jamais à un chemin du disque).
fn resolve(base: &str, target: &str) -> String {
    let mut parts: Vec<&str> = if target.starts_with('/') {
        Vec::new()
    } else {
        base.split('/').filter(|s| !s.is_empty()).collect()
    };
    for seg in target.trim_start_matches('/').split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|p| *p != "..") {
                    parts.pop();
                } else {
                    parts.push("..");
                }
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

/// Dossier d'une partie : `ppt/slides/slide1.xml` donne `ppt/slides`.
fn dir_of(part: &str) -> &str {
    part.rsplit_once('/').map_or("", |(dir, _)| dir)
}

/// Lit une diapo et ses relations ; une diapo absente ou illisible est vide.
fn load_slide(media: &mut Media<'_>, part: &str) -> LoadedSlide {
    let slide = read_part(media.archive, part)
        .and_then(|xml| tokenize(&xml))
        .map(|events| parse_slide(&events))
        .unwrap_or_default();
    let (dir, file) = part.rsplit_once('/').unwrap_or(("", part));
    let rels_name = if dir.is_empty() {
        format!("_rels/{file}.rels")
    } else {
        format!("{dir}/_rels/{file}.rels")
    };
    let rels = read_part(media.archive, &rels_name)
        .map(|x| relations(&x))
        .unwrap_or_default();
    LoadedSlide {
        slide,
        rels,
        dir: dir_of(part).to_owned(),
    }
}

#[derive(Default)]
struct LoadedSlide {
    slide: Slide,
    rels: HashMap<String, String>,
    dir: String,
}

/// Extraction des images sous `media/`, avec les garde-fous de taille.
struct Media<'a> {
    archive: &'a mut Archive,
    dir: PathBuf,
    /// Entrée d'archive vers nom écrit (`None` : ignorée).
    done: HashMap<String, Option<String>>,
    used: HashSet<String>,
    total: u64,
}

impl<'a> Media<'a> {
    fn new(archive: &'a mut Archive, dir: PathBuf) -> Self {
        Self {
            archive,
            dir,
            done: HashMap::new(),
            used: HashSet::new(),
            total: 0,
        }
    }

    /// Nom, sous `media/`, de l'image de l'entrée `entry` (extraite à la première demande).
    fn image(&mut self, entry: &str) -> Option<String> {
        if let Some(known) = self.done.get(entry) {
            return known.clone();
        }
        let name = self.extract(entry);
        self.done.insert(entry.to_owned(), name.clone());
        name
    }

    fn extract(&mut self, entry: &str) -> Option<String> {
        let base = safe_name(entry);
        let ext = base.rsplit_once('.')?.1.to_ascii_lowercase();
        if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            return None;
        }
        let file = self.archive.by_name(entry).ok()?;
        if file.size() > MAX_PART_BYTES {
            return None;
        }
        let mut bytes = Vec::new();
        file.take(MAX_PART_BYTES + 1).read_to_end(&mut bytes).ok()?;
        let len = bytes.len() as u64;
        if len > MAX_PART_BYTES || self.total + len > MAX_TOTAL_BYTES {
            return None;
        }
        let mut name = base.clone();
        let mut n = 2;
        while !self.used.insert(name.clone()) {
            name = format!("{n}-{base}");
            n += 1;
        }
        fs::write(self.dir.join(&name), bytes).ok()?;
        self.total += len;
        Some(name)
    }
}

/// Nom de fichier sûr : nom de base seulement, caractères `[A-Za-z0-9._-]`, sans `..`.
fn safe_name(entry: &str) -> String {
    let base = entry.rsplit(['/', '\\']).next().unwrap_or_default();
    let mut name: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect();
    while name.contains("..") {
        name = name.replace("..", "_");
    }
    if name.is_empty() || name.starts_with('.') {
        name.insert(0, '_');
    }
    name
}

/// Texte échappé pour du HTML (`&`, `<`, `>`, `"`, `'`).
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

fn px(emu: f64) -> i64 {
    (emu / EMU_PER_PX).round() as i64
}

/// Hauteur approximative d'un texte empilé, en px (lignes sans retour automatique).
fn estimated_height(paras: &[Para]) -> f64 {
    paras
        .iter()
        .map(|p| {
            let size = p
                .runs
                .iter()
                .filter_map(|r| r.size)
                .max()
                .map_or(DEFAULT_FONT_PT, |s| f64::from(s) / 100.0);
            let lines = 1 + p.runs.iter().filter(|r| r.text == "\n").count();
            size * 96.0 / 72.0 * 1.2 * lines as f64
        })
        .sum()
}

fn render_slide(
    out: &mut String,
    loaded: &LoadedSlide,
    width: u32,
    height: u32,
    media: &mut Media<'_>,
) {
    let bg = loaded.slide.bg.as_deref().unwrap_or("FFFFFF");
    let _ = write!(out, "<div class=\"slide\" style=\"background:#{bg}\">");
    let mut cursor = f64::from(height) * 0.05;
    for item in &loaded.slide.items {
        match item {
            Item::Pic { embed, rect } => {
                let Some(target) = loaded.rels.get(embed) else {
                    continue;
                };
                let Some(name) = media.image(&resolve(&loaded.dir, target)) else {
                    continue;
                };
                let _ = write!(
                    out,
                    "<img src=\"media/{}\" alt=\"\" style=\"position:absolute;{}\">",
                    escape(&name),
                    place(*rect)
                );
            }
            Item::Text { rect, paras } => {
                let style = if let Some(r) = rect {
                    place(*r)
                } else {
                    let w = f64::from(width);
                    let h = estimated_height(paras);
                    let style = format!(
                        "left:{}px;top:{}px;width:{}px",
                        (w * 0.05).round() as i64,
                        cursor.round() as i64,
                        (w * 0.9).round() as i64
                    );
                    cursor += h + 4.0;
                    style
                };
                let _ = write!(out, "<div style=\"position:absolute;{style}\">");
                for p in paras {
                    render_para(out, p);
                }
                out.push_str("</div>");
            }
        }
    }
    out.push_str("</div>\n");
}

fn place(r: Rect) -> String {
    format!(
        "left:{}px;top:{}px;width:{}px;height:{}px",
        px(r.x),
        px(r.y),
        px(r.cx),
        px(r.cy)
    )
}

fn render_para(out: &mut String, para: &Para) {
    if para.runs.is_empty() {
        out.push_str("<p><br></p>");
        return;
    }
    out.push_str("<p>");
    for run in &para.runs {
        if run.text == "\n" {
            out.push_str("<br>");
            continue;
        }
        let size = run.size.map_or(DEFAULT_FONT_PT, |s| f64::from(s) / 100.0);
        let _ = write!(out, "<span style=\"font-size:{size}pt");
        if run.bold {
            out.push_str(";font-weight:bold");
        }
        if let Some(c) = &run.color {
            let _ = write!(out, ";color:#{c}");
        }
        let _ = write!(out, "\">{}</span>", escape(&run.text));
    }
    out.push_str("</p>");
}
