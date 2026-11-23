#!/usr/bin/env bash
# Re-fetches the sources FINAL-STATE-FIX added and checks each quotation is verbatim in them.
set -euo pipefail
d=$(mktemp -d)
fetch() { curl -sL -A 'Mozilla/5.0' -o "$d/$1.html" "$2"; }
fetch s15 'https://dicom.nema.org/medical/dicom/current/output/chtml/part08/sect_7.2.html'
fetch s17 'https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/jj574204(v=ws.11)'
fetch s18a 'https://www.legislation.gov.uk/eur/2017/745/article/2/adopted'
fetch s18b 'https://www.legislation.gov.uk/eur/2017/746/article/2/adopted'
fetch s18a-eurlex 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32017R0745'
fetch s18b-eurlex 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32017R0746'
python3 -I - "$d" <<'PY'
import html, re, sys
d = sys.argv[1]
def text(f):
    t = open(f"{d}/{f}.html", encoding="utf-8", errors="replace").read()
    t = html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S)))
    return re.sub(r"\s+", " ", t.translate(str.maketrans("‘’“”", "''\"\"")))
ce = "'clinical evaluation' means a systematic and planned process to continuously generate, collect, analyse and assess the clinical data pertaining to a device in order to verify the safety and performance, including clinical benefits, of the device when used as intended by the manufacturer"
pe = "'performance evaluation' means an assessment and analysis of data to establish or verify the scientific validity, the analytical and, where applicable, the clinical performance of a device"
quotes = {
    "s15": ["The graceful release of an association between two AEs shall be performed through ACSE A-RELEASE request, indication, response, and confirmation primitives.", "DICOM PS3.8 2026e"],
    "s17": ["Fully functional time-limited evaluation versions of Windows Server 2012 are available for the following editions",
            "you have 10 days to complete online activation, at which point the evaluation period begins and runs for 180 days."],
    "s18a": ["(44) " + ce], "s18a-eurlex": [ce], "s18b": ["(44) " + pe], "s18b-eurlex": [pe],
}
for f, qs in quotes.items():
    t = text(f)
    for q in qs:
        print("verbatim" if q in t else "MISSING", f, q[:60])
PY
