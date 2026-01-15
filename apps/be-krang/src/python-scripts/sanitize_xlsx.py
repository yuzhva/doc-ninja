import sys
import zipfile
import re

if len(sys.argv) < 3:
    print("Usage: python sanitize_xlsx.py <input_file> <output_file>")
    sys.exit(1)

input_file = sys.argv[1]
output_file = sys.argv[2]

modified_files = []
removed_files = []

def sanitize_rels_content(content):
    """
    Removes Relationship tags that point to drawings, VML, images, or comments.
    """
    def rel_filter(match):
        tag = match.group(0)
        tag_lower = tag.lower()
        if (
            'relationships/drawing' in tag_lower or
            'relationships/vmldrawing' in tag_lower or
            'relationships/image' in tag_lower or
            'relationships/comments' in tag_lower or
            '.vml' in tag_lower or
            'drawings/' in tag_lower or
            'comments' in tag_lower
        ):
            return ''
        return tag

    # Match <Relationship ... > tags (including self-closing />)
    return re.sub(r'<Relationship\b[^>]*?>', rel_filter, content, flags=re.IGNORECASE | re.DOTALL)

try:
    print(f"Opening input file: {input_file}")
    with zipfile.ZipFile(input_file, 'r') as zin:
        file_list = zin.infolist()
        print(f"Total files in archive: {len(file_list)}")

        with zipfile.ZipFile(output_file, 'w') as zout:
            zout.comment = zin.comment
            for item in file_list:
                lower_name = item.filename.lower()

                # 1. Skip VML, Drawing, and Comment files entirely
                if (lower_name.endswith('.vml') or
                    lower_name.startswith('xl/drawings/') or
                    lower_name.startswith('xl/comments')):
                    print(f"Removing file: {item.filename}")
                    removed_files.append(item.filename)
                    continue

                # Read content for processing
                content = zin.read(item.filename)

                # 2. Process Worksheets to remove references to drawings/VML/OLE/Controls
                if item.filename.startswith('xl/worksheets/') and item.filename.endswith('.xml'):
                    try:
                        text_content = content.decode('utf-8')
                        original_content = text_content

                        # Remove simple tags (self-closing or empty)
                        # <drawing r:id="..."/>
                        new_content = re.sub(r'<[\w:]*drawing\s+[^>]*?>', '', text_content, flags=re.DOTALL)
                        # <legacyDrawing r:id="..."/>
                        new_content = re.sub(r'<[\w:]*legacyDrawing\s+[^>]*?>', '', new_content, flags=re.DOTALL)
                        # <legacyDrawingHF r:id="..."/> (Header/Footer drawings)
                        new_content = re.sub(r'<[\w:]*legacyDrawingHF\s+[^>]*?>', '', new_content, flags=re.DOTALL)
                        # <picture r:id="..."/>
                        new_content = re.sub(r'<[\w:]*picture\s+[^>]*?>', '', new_content, flags=re.DOTALL)

                        # Remove block tags (OLE objects, Controls)
                        # <oleObjects> ... </oleObjects>
                        new_content = re.sub(r'<[\w:]*oleObjects\b.*?</[\w:]*oleObjects>', '', new_content, flags=re.DOTALL)
                        # <controls> ... </controls>
                        new_content = re.sub(r'<[\w:]*controls\b.*?</[\w:]*controls>', '', new_content, flags=re.DOTALL)

                        if new_content != original_content:
                            print(f"Sanitized worksheet: {item.filename}")
                            modified_files.append(item.filename)
                            zout.writestr(item, new_content.encode('utf-8'))
                        else:
                            zout.writestr(item, content)
                    except Exception as e:
                        print(f"Warning: Failed to process worksheet {item.filename}: {e}")
                        zout.writestr(item, content)

                # 3. Process Relationships (.rels) to remove dangling references
                elif item.filename.endswith('.rels'):
                    try:
                        text_content = content.decode('utf-8')
                        original_content = text_content

                        new_content = sanitize_rels_content(text_content)

                        if new_content != original_content:
                            print(f"Sanitized rels: {item.filename}")
                            modified_files.append(item.filename)
                            zout.writestr(item, new_content.encode('utf-8'))
                        else:
                            zout.writestr(item, content)
                    except Exception as e:
                        print(f"Warning: Failed to process rels {item.filename}: {e}")
                        zout.writestr(item, content)

                else:
                    zout.writestr(item, content)

    print(f"Success. Removed {len(removed_files)} files. Modified {len(modified_files)} files.")

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
