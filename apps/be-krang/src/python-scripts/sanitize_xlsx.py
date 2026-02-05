import sys
import zipfile
import os

def sanitize(input_file, output_file):
    print(f"Sanitizing (RAW ZIP) {input_file}...")

    try:
        with zipfile.ZipFile(input_file, 'r') as zin:
            with zipfile.ZipFile(output_file, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    data = zin.read(item.filename)

                    # Fix VML files containing <br> tags which crash SAX parsers (like the one in ExcelJS)
                    if item.filename.endswith('.vml'):
                        try:
                            # Typical encoding for XML
                            text = data.decode('utf-8', errors='ignore')
                            if '<br>' in text:
                                print(f"  Fixing malformed XML (removing <br>) in {item.filename}")
                                text = text.replace('<br>', '')
                                data = text.encode('utf-8')
                        except Exception as e:
                            print(f"  Warning: Failed to process text in {item.filename}: {e}")

                    # Copy the file (modified or original) to the new zip
                    zout.writestr(item, data)
        print("Done.")

    except Exception as e:
        print(f"Error during sanitization: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python sanitize_xlsx.py <input_file> <output_file>")
        sys.exit(1)

    sanitize(sys.argv[1], sys.argv[2])
