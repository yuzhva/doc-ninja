Based on your investigation and the error logs, the crash in exceljs (Cannot read properties of undefined (reading 'name')) occurs because the library tries to load media (images) referenced in the VML/Drawing files but fails to find them in the workbook's media collection. This often happens with malformed or legacy VML shapes (like buttons) that exceljs misinterprets as having image data.

Since you confirmed that deleting the xl/drawings folder fixes the issue, and your goal is to extract text (chunks), we can safely wipe the content of these drawing files instead of trying to patch them with regex. This effectively removes the problematic shapes/buttons while keeping the file structure valid, preventing exceljs from attempting to load the broken media references.

I've updated the script to:

Wipe VML files: Replace content with an empty valid <xml> root.
Wipe DrawingML files: Replace content with an empty valid <xdr:wsDr> root.
Sanitize Comments: Keep the <br> removal logic for comment text files, as those might still contain useful text data.
