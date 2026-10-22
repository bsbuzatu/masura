# Măsura — metronom și song chart de scenă

Aplicație web instalabilă (PWA), funcționează complet offline după prima deschidere.

- Concerte (setlisturi) → piese (BPM, măsură, gamă) → secțiuni în măsuri (fixe sau deschise)
- Count-in per piesă: pregătire + bețe
- Metronom liber: tempo, măsură, subdiviziuni, tap tempo (nu se transmite către monitoare)
- Click cu volum separat pentru timpul 1, timpii 2–4 și optimi
- Datele stau local pe dispozitiv; export/import JSON pentru backup și transfer

Găzduire: orice server static (ex. GitHub Pages). La fiecare actualizare, crește `VERSION` în `sw.js`.
