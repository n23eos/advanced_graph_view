# Validation

Parse manifest.json and compare its id/name with the published listing. Check description length and punctuation, fundingUrl and desktop flag, LICENSE, version alignment, README stable installation instructions and private-note ignore pattern.

Use git diff --check and literal U+2013/U+2014 scan on authored files. Documentation changes do not require new runtime unit tests. The final integration must still pass npm run verify and npm run build. Do not push tags or trigger release workflow. Native acceptance remains separately documented.
