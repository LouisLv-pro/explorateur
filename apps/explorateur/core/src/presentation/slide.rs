//! Lecture d'un XML de diapo (DrawingML) : images et zones de texte positionnées.

use std::collections::HashMap;

use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};

/// Événement XML simplifié : noms sans préfixe d'espace de noms.
pub(super) enum Ev {
    Open(Tag),
    Close(String),
    Text(String),
}

/// Balise ouvrante : nom local et attributs (clé complète, par exemple `r:embed`).
pub(super) struct Tag {
    pub name: String,
    attrs: Vec<(String, String)>,
}

impl Tag {
    /// Valeur de l'attribut de clé exacte `key`.
    pub fn attr(&self, key: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    fn number(&self, key: &str) -> Option<f64> {
        self.attr(key)?.trim().parse().ok()
    }
}

fn local(name: &str) -> String {
    name.rsplit(':').next().unwrap_or_default().to_owned()
}

fn tag_of(e: &BytesStart<'_>) -> Option<Tag> {
    let mut attrs = Vec::new();
    for a in e.attributes() {
        let a = a.ok()?;
        let key = a.key.as_ref().to_owned();
        let value = a
            .normalized_value(XmlVersion::Implicit1_0)
            .ok()?
            .into_owned();
        attrs.push((key, value));
    }
    Some(Tag {
        name: local(e.name().as_ref()),
        attrs,
    })
}

/// Découpe `xml` en événements. `None` si le XML est mal formé (erreur du lecteur, ou balises
/// non refermées : `quick-xml` ne s'en plaint pas à la fin du fichier).
pub(super) fn tokenize(xml: &[u8]) -> Option<Vec<Ev>> {
    let mut reader = Reader::from_reader(xml);
    let mut buf = Vec::new();
    let mut out = Vec::new();
    let mut depth: i64 = 0;
    loop {
        match reader.read_event_into(&mut buf).ok()? {
            Event::Eof => break,
            Event::Start(e) => {
                depth += 1;
                out.push(Ev::Open(tag_of(&e)?));
            }
            Event::Empty(e) => {
                let tag = tag_of(&e)?;
                let name = tag.name.clone();
                out.push(Ev::Open(tag));
                out.push(Ev::Close(name));
            }
            Event::End(e) => {
                depth -= 1;
                out.push(Ev::Close(local(e.name().as_ref())));
            }
            Event::Text(t) => out.push(Ev::Text(
                t.xml_content(XmlVersion::Implicit1_0).into_owned(),
            )),
            Event::CData(c) => out.push(Ev::Text(c.into_inner().into_owned())),
            Event::GeneralRef(r) => {
                let text = match r.resolve_char_ref().ok()? {
                    Some(c) => c.to_string(),
                    None => quick_xml::escape::resolve_predefined_entity(&r)?.to_owned(),
                };
                out.push(Ev::Text(text));
            }
            _ => {}
        }
        buf.clear();
    }
    (depth == 0).then_some(out)
}

/// Relations d'une partie (`Id` vers `Target`).
pub(super) fn relations(xml: &[u8]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for ev in tokenize(xml).unwrap_or_default() {
        if let Ev::Open(t) = ev
            && t.name == "Relationship"
            && let (Some(id), Some(target)) = (t.attr("Id"), t.attr("Target"))
        {
            map.insert(id.to_owned(), target.to_owned());
        }
    }
    map
}

/// Rectangle en EMU.
#[derive(Clone, Copy, Default)]
pub(super) struct Rect {
    pub x: f64,
    pub y: f64,
    pub cx: f64,
    pub cy: f64,
}

/// Transformation affine d'un groupe : `X = x × sx + tx`, `Y = y × sy + ty`.
#[derive(Clone, Copy)]
struct Tf {
    sx: f64,
    sy: f64,
    tx: f64,
    ty: f64,
}

impl Tf {
    const IDENTITY: Self = Self {
        sx: 1.0,
        sy: 1.0,
        tx: 0.0,
        ty: 0.0,
    };

    fn rect(self, r: Rect) -> Rect {
        Rect {
            x: r.x * self.sx + self.tx,
            y: r.y * self.sy + self.ty,
            cx: r.cx * self.sx,
            cy: r.cy * self.sy,
        }
    }
}

/// Morceau de texte : taille en centièmes de point, gras, couleur `RRGGBB`. `text` vaut `"\n"`
/// pour un saut de ligne.
#[derive(Default)]
pub(super) struct Run {
    pub text: String,
    pub size: Option<u32>,
    pub bold: bool,
    pub color: Option<String>,
}

#[derive(Default)]
pub(super) struct Para {
    pub runs: Vec<Run>,
}

pub(super) enum Item {
    Pic {
        embed: String,
        rect: Rect,
    },
    Text {
        rect: Option<Rect>,
        paras: Vec<Para>,
    },
}

#[derive(Default)]
pub(super) struct Slide {
    /// Couleur de fond `RRGGBB`.
    pub bg: Option<String>,
    pub items: Vec<Item>,
}

/// Coordonnées d'un `a:xfrm` en cours de lecture.
#[derive(Default)]
struct Xfrm {
    off: Option<(f64, f64)>,
    ext: Option<(f64, f64)>,
    ch_off: Option<(f64, f64)>,
    ch_ext: Option<(f64, f64)>,
}

enum Current {
    None,
    Pic {
        embed: Option<String>,
        rect: Option<Rect>,
    },
    Sp {
        rect: Option<Rect>,
        paras: Vec<Para>,
    },
}

fn pair(t: &Tag, a: &str, b: &str) -> Option<(f64, f64)> {
    Some((t.number(a)?, t.number(b)?))
}

/// Une couleur `srgbClr` valide : six chiffres hexadécimaux (rien d'autre n'entre dans le CSS).
fn hex_color(v: &str) -> Option<String> {
    (v.len() == 6 && v.bytes().all(|b| b.is_ascii_hexdigit())).then(|| v.to_owned())
}

/// Lit la diapo : fond, images et zones de texte, dans l'ordre du document (donc de
/// superposition), les enfants des groupes passés par la transformation du groupe.
pub(super) fn parse_slide(events: &[Ev]) -> Slide {
    let mut slide = Slide::default();
    let mut path: Vec<&str> = Vec::new();
    let mut tfs = vec![Tf::IDENTITY];
    let mut group_pushed: Vec<bool> = Vec::new();
    let mut xf = Xfrm::default();
    let mut cur = Current::None;
    let mut run: Option<Run> = None;
    let mut in_t = false;

    for ev in events {
        match ev {
            Ev::Open(t) => {
                path.push(t.name.as_str());
                let n = path.len();
                let parent = if n >= 2 { path[n - 2] } else { "" };
                let grand = if n >= 3 { path[n - 3] } else { "" };
                match t.name.as_str() {
                    "grpSp" => group_pushed.push(false),
                    "pic" => {
                        cur = Current::Pic {
                            embed: None,
                            rect: None,
                        };
                    }
                    "sp" => {
                        cur = Current::Sp {
                            rect: None,
                            paras: Vec::new(),
                        };
                    }
                    "xfrm" => xf = Xfrm::default(),
                    "off" if parent == "xfrm" => xf.off = pair(t, "x", "y"),
                    "ext" if parent == "xfrm" => xf.ext = pair(t, "cx", "cy"),
                    "chOff" => xf.ch_off = pair(t, "x", "y"),
                    "chExt" => xf.ch_ext = pair(t, "cx", "cy"),
                    "blip" => {
                        if let Current::Pic { embed, .. } = &mut cur {
                            *embed = t.attr("r:embed").map(str::to_owned);
                        }
                    }
                    "p" if parent == "txBody" => {
                        if let Current::Sp { paras, .. } = &mut cur {
                            paras.push(Para::default());
                        }
                    }
                    "r" | "fld" => run = Some(Run::default()),
                    "rPr" => {
                        if let Some(r) = &mut run {
                            r.size = t.attr("sz").and_then(|v| v.trim().parse().ok());
                            r.bold = matches!(t.attr("b"), Some("1" | "true"));
                        }
                    }
                    "srgbClr" if parent == "solidFill" => {
                        let color = t.attr("val").and_then(hex_color);
                        match grand {
                            "rPr" => {
                                if let Some(r) = &mut run {
                                    r.color = color;
                                }
                            }
                            "bgPr" => slide.bg = color,
                            _ => {}
                        }
                    }
                    "t" => in_t = true,
                    "br" => {
                        if let Current::Sp { paras, .. } = &mut cur
                            && let Some(p) = paras.last_mut()
                        {
                            p.runs.push(Run {
                                text: "\n".to_owned(),
                                ..Run::default()
                            });
                        }
                    }
                    _ => {}
                }
            }
            Ev::Text(text) => {
                if in_t && let Some(r) = &mut run {
                    r.text.push_str(text);
                }
            }
            Ev::Close(name) => {
                let n = path.len();
                let parent = if n >= 2 { path[n - 2] } else { "" };
                let grand = if n >= 3 { path[n - 3] } else { "" };
                match name.as_str() {
                    "t" => in_t = false,
                    "r" | "fld" => {
                        if let Some(r) = run.take()
                            && !r.text.is_empty()
                            && let Current::Sp { paras, .. } = &mut cur
                            && let Some(p) = paras.last_mut()
                        {
                            p.runs.push(r);
                        }
                    }
                    "xfrm" => close_xfrm(&xf, parent, grand, &mut tfs, &mut group_pushed, &mut cur),
                    "grpSp" => {
                        if group_pushed.pop() == Some(true) && tfs.len() > 1 {
                            tfs.pop();
                        }
                    }
                    "pic" => {
                        if let Current::Pic {
                            embed: Some(embed),
                            rect: Some(rect),
                        } = std::mem::replace(&mut cur, Current::None)
                        {
                            slide.items.push(Item::Pic { embed, rect });
                        }
                    }
                    "sp" => {
                        if let Current::Sp { rect, paras } =
                            std::mem::replace(&mut cur, Current::None)
                            && paras.iter().any(|p| !p.runs.is_empty())
                        {
                            slide.items.push(Item::Text { rect, paras });
                        }
                    }
                    _ => {}
                }
                path.pop();
            }
        }
    }
    slide
}

/// Fin d'un `a:xfrm` : transformation d'un groupe (dans `p:grpSpPr` d'un `p:grpSp`) ou
/// rectangle de la forme courante (dans `p:spPr`).
fn close_xfrm(
    xf: &Xfrm,
    parent: &str,
    grand: &str,
    tfs: &mut Vec<Tf>,
    group_pushed: &mut [bool],
    cur: &mut Current,
) {
    let top = tfs.last().copied().unwrap_or(Tf::IDENTITY);
    let (Some((x, y)), Some((cx, cy))) = (xf.off, xf.ext) else {
        return;
    };
    match (parent, grand) {
        ("grpSpPr", "grpSp") => {
            let placed = top.rect(Rect { x, y, cx, cy });
            let (chx, chy) = xf.ch_off.unwrap_or((x, y));
            let (chcx, chcy) = xf.ch_ext.unwrap_or((cx, cy));
            let sx = if chcx > 0.0 { placed.cx / chcx } else { 1.0 };
            let sy = if chcy > 0.0 { placed.cy / chcy } else { 1.0 };
            tfs.push(Tf {
                sx,
                sy,
                tx: placed.x - chx * sx,
                ty: placed.y - chy * sy,
            });
            if let Some(flag) = group_pushed.last_mut() {
                *flag = true;
            }
        }
        ("spPr", _) => {
            let placed = Some(top.rect(Rect { x, y, cx, cy }));
            match cur {
                Current::Pic { rect, .. } | Current::Sp { rect, .. } => *rect = placed,
                Current::None => {}
            }
        }
        _ => {}
    }
}
