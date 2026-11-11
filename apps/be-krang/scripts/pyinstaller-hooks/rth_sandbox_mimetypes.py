# PyInstaller runtime hook: runs before each compiled script (only in the
# binaries, never for `python3 script.py` in development).
#
# openpyxl builds a mimetypes.MimeTypes() on import, and that reads the system
# MIME lists (knownfiles: /etc/mime.types, /etc/apache2/mime.types, ...). In
# the Mac App Store sandbox those files pass the exists check but can't be
# opened: PermissionError, and the script dies before it starts. Python's
# built-in table already has every type openpyxl writes (xml, png, jpeg, ...),
# so the system files are skipped everywhere for the same result on all OSes.
import mimetypes

mimetypes.knownfiles = []
