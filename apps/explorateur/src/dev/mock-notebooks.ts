// Notebooks du faux disque (spec notebook.md, navigateur simulé), au format exact de Jupyter
// (clés triées, indentation d'un espace, retour à la ligne final). `String.raw` garde les
// échappements JSON (`\n`, `\u001b`) tels quels. Image et tableau produits par matplotlib et
// pandas.

/** Markdown, tableau pandas, graphique PNG, erreur avec pile ANSI, `stream` avec `\r`. */
export const ANALYSE_IPYNB = String.raw`{
 "cells": [
  {
   "cell_type": "markdown",
   "id": "md000001",
   "metadata": {},
   "source": [
    "# Analyse des ventes\n",
    "\n",
    "Données **fictives** par ville."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 1,
   "id": "code0001",
   "metadata": {},
   "outputs": [
    {
     "data": {
      "text/html": [
       "<div>\n",
       "<style scoped>\n",
       "    .dataframe tbody tr th:only-of-type {\n",
       "        vertical-align: middle;\n",
       "    }\n",
       "\n",
       "    .dataframe tbody tr th {\n",
       "        vertical-align: top;\n",
       "    }\n",
       "\n",
       "    .dataframe thead th {\n",
       "        text-align: right;\n",
       "    }\n",
       "</style>\n",
       "<table border=\"1\" class=\"dataframe\">\n",
       "  <thead>\n",
       "    <tr style=\"text-align: right;\">\n",
       "      <th></th>\n",
       "      <th>ville</th>\n",
       "      <th>ventes</th>\n",
       "    </tr>\n",
       "  </thead>\n",
       "  <tbody>\n",
       "    <tr>\n",
       "      <th>0</th>\n",
       "      <td>Lyon</td>\n",
       "      <td>120</td>\n",
       "    </tr>\n",
       "    <tr>\n",
       "      <th>1</th>\n",
       "      <td>Nantes</td>\n",
       "      <td>85</td>\n",
       "    </tr>\n",
       "    <tr>\n",
       "      <th>2</th>\n",
       "      <td>Lille</td>\n",
       "      <td>97</td>\n",
       "    </tr>\n",
       "  </tbody>\n",
       "</table>\n",
       "</div>"
      ],
      "text/plain": [
       "    ville  ventes\n",
       "0    Lyon     120\n",
       "1  Nantes      85\n",
       "2   Lille      97"
      ]
     },
     "execution_count": 1,
     "metadata": {},
     "output_type": "execute_result"
    }
   ],
   "source": [
    "import pandas as pd\n",
    "\n",
    "df = pd.DataFrame({\"ville\": [\"Lyon\", \"Nantes\", \"Lille\"], \"ventes\": [120, 85, 97]})\n",
    "df"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 2,
   "id": "code0002",
   "metadata": {},
   "outputs": [
    {
     "data": {
      "image/png": "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\n",
      "text/plain": [
       "<Figure size 300x200 with 1 Axes>"
      ]
     },
     "metadata": {},
     "output_type": "display_data"
    }
   ],
   "source": [
    "df.plot.bar(x=\"ville\", y=\"ventes\")"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 3,
   "id": "code0003",
   "metadata": {},
   "outputs": [
    {
     "ename": "ZeroDivisionError",
     "evalue": "division by zero",
     "output_type": "error",
     "traceback": [
      "\u001b[0;31m---------------------------------------------------------------------------\u001b[0m",
      "\u001b[0;31mZeroDivisionError\u001b[0m                         Traceback (most recent call last)",
      "Cell \u001b[0;32mIn[3], line 1\u001b[0m\n\u001b[0;32m----> 1\u001b[0m \u001b[38;5;241m1\u001b[39m\u001b[38;5;241m/\u001b[39m\u001b[38;5;241m0\u001b[39m\n",
      "\u001b[0;31mZeroDivisionError\u001b[0m: division by zero"
     ]
    }
   ],
   "source": [
    "1/0"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 4,
   "id": "code0004",
   "metadata": {},
   "outputs": [
    {
     "name": "stdout",
     "output_type": "stream",
     "text": [
      "Chargement 10%\r",
      "Chargement 50%\r",
      "Chargement 100%\n",
      "Terminé\n"
     ]
    }
   ],
   "source": [
    "for p in (10, 50, 100):\n",
    "    print(f\"\\rChargement {p}%\", end=\"\")\n",
    "print(\"\\nTerminé\")"
   ]
  }
 ],
 "metadata": {
  "kernelspec": {
   "display_name": "Python 3 (ipykernel)",
   "language": "python",
   "name": "python3"
  },
  "language_info": {
   "codemirror_mode": {
    "name": "ipython",
    "version": 3
   },
   "file_extension": ".py",
   "mimetype": "text/x-python",
   "name": "python",
   "nbconvert_exporter": "python",
   "pygments_lexer": "ipython3",
   "version": "3.12.4"
  }
 },
 "nbformat": 4,
 "nbformat_minor": 5
}
`;

/** Notebook sans cellule. */
export const VIDE_IPYNB = String.raw`{
 "cells": [],
 "metadata": {
  "kernelspec": {
   "display_name": "Python 3 (ipykernel)",
   "language": "python",
   "name": "python3"
  }
 },
 "nbformat": 4,
 "nbformat_minor": 5
}
`;

/** JSON tronqué : la vue montre la bannière et la source. */
export const INVALIDE_IPYNB = `{
 "cells": [
  {
   "cell_type": "code",
   "source": ["print(1)"
`;
