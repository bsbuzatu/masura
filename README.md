# Măsura — metronom și song chart de scenă

Aplicație web instalabilă (PWA), funcționează complet offline după prima deschidere.

- Concerte (setlisturi) → piese (BPM, măsură, gamă) → secțiuni în măsuri (fixe sau deschise)
- Count-in per piesă: pregătire + bețe
- Metronom liber: tempo, măsură, subdiviziuni, tap tempo (nu se transmite către monitoare)
- Click cu volum separat pentru timpul 1, timpii 2–4 și optimi
- Datele stau local pe dispozitiv; export/import JSON pentru backup și transfer

Găzduire: orice server static (ex. GitHub Pages). La fiecare actualizare, crește `VERSION` în `sw.js`.

## Audio pe scenă (v1.14)

Contextul audio se creează cu `latencyHint: 'playback'` și `sampleRate: 48000` (rata plăcii M-Track Duo), cu revenire automată la `playback` fără rată și apoi la valorile implicite dacă browserul refuză. Bufferul mai mare previne clickul granulat/pârâit care apărea după zeci de minute când iPhone-ul se încălzea și iOS încetinea procesorul; rata fixă evită conversia în timp real. Sincronizarea vizuală rămâne compensată cu `outputLatency`/`baseLatency` (`audibleNow()`), inclusiv pentru monitoarele colegilor. Diagnostic: în Setări, ține apăsat pe „Măsura v…” → rata și latențele negociate de iOS.
