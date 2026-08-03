#!/usr/bin/env bash
# Extract the changelog section body for a given version from CHANGELOG.md.
#
# Usage: extract-changelog-section.sh <version> [changelog-file]
#   version        e.g. 0.1.0 or v0.1.0 (leading 'v' is stripped)
#   changelog-file path to CHANGELOG.md (default: ./CHANGELOG.md)
#
# Output (stdout): everything under the "## [version] - date" header, up to
# (but not including) the next "## " section. The header line itself is
# omitted so the output can be used directly as a GitHub Release body.
#
# Exits non-zero if the version section is not found.

set -euo pipefail

VERSION="${1#v}"                       # strip a leading 'v' if present
CHANGELOG="${2:-CHANGELOG.md}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version> [changelog-file]" >&2
  exit 1
fi

if [[ ! -f "$CHANGELOG" ]]; then
  echo "Error: changelog file not found: $CHANGELOG" >&2
  exit 1
fi

# Locate the version header line: "## [VERSION]" (optionally followed by " - date").
START_LINE=$(grep -n "^## \[${VERSION}\]" "$CHANGELOG" | head -1 | cut -d: -f1)

if [[ -z "$START_LINE" ]]; then
  echo "Error: version [${VERSION}] not found in ${CHANGELOG}" >&2
  echo "Add a '## [${VERSION}] - YYYY-MM-DD' section before releasing." >&2
  exit 1
fi

# Find the next "## " line after START_LINE (i.e. the next version section).
NEXT_LINE=$(awk -v start="$START_LINE" 'NR > start && /^## / {print NR; exit}' "$CHANGELOG")

if [[ -z "$NEXT_LINE" ]]; then
  # No following section: take everything after the header to EOF.
  END_LINE=$(wc -l < "$CHANGELOG" | tr -d ' ')
else
  END_LINE=$((NEXT_LINE - 1))
fi

# Print from the line after the header up to END_LINE.
# Then strip markdown link-reference definitions (e.g. "[0.1.0]: https://...")
# — those belong to the rendered CHANGELOG.md, not the release body.
sed -n "$((START_LINE + 1)),${END_LINE}p" "$CHANGELOG" \
  | grep -v '^\[[^]]*\]: '
