import sys
import json
import os
import re
import datetime
import traceback
import concurrent.futures
from openpyxl import load_workbook
from openpyxl.worksheet.views import Selection
import multiprocessing

def cleanup_workbook(wb):
    print("Cleaning up workbook structure to prevent corruption warnings...")

    # 1. Remove Calculation Chain
    if hasattr(wb, '_calc_chain'):
        wb._calc_chain = None

    # 2. Remove External Links
    if hasattr(wb, 'external_links'):
        wb.external_links = []

    # 3. Cleanup Defined Names (Named Ranges)
    if hasattr(wb, 'defined_names') and hasattr(wb.defined_names, 'definedName'):
        valid_names = []
        for dn in wb.defined_names.definedName:
            should_keep = True
            if not dn.value:
                should_keep = False
            elif '#REF!' in dn.value:
                should_keep = False
            elif '[' in dn.value and ']' in dn.value:
                should_keep = False

            if should_keep:
                valid_names.append(dn)
        wb.defined_names.definedName = valid_names

    # # 4. Remove Tables
    # print("Removing tables to prevent corruption...")
    # for ws in wb.worksheets:
    #     if hasattr(ws, 'tables'):
    #         table_names = list(ws.tables.keys())
    #         if table_names:
    #             print(f"  Removing {len(table_names)} tables from sheet '{ws.title}'")
    #             for name in table_names:
    #                 del ws.tables[name]

    # 5. Reset View
    if wb.sheetnames:
        wb.active = 0  # Select first sheet

    for ws in wb:
        # Scroll to top-left
        ws.sheet_view.topLeftCell = 'A1'
        # Reset selection to A1
        ws.sheet_view.selection = [Selection(activeCell='A1', sqref='A1')]

def get_ranges_to_delete(all_rows_count, keep_row_indices, header_rows):
    """
    Returns a list of (start, count) tuples for rows to delete,
    sorted in descending order of start index to safely delete from bottom up.
    """
    if all_rows_count <= header_rows:
        return []

    keep_set = set(keep_row_indices)
    ranges = []

    current_start = None

    # Scan from header_rows + 1 to all_rows_count
    for r in range(header_rows + 1, all_rows_count + 1):
        if r not in keep_set:
            if current_start is None:
                current_start = r
        else:
            if current_start is not None:
                # End of a deletion block
                count = r - current_start
                ranges.append((current_start, count))
                current_start = None

    if current_start is not None:
        count = all_rows_count + 1 - current_start
        ranges.append((current_start, count))

    # Sort descending by start to delete from bottom up
    ranges.sort(key=lambda x: x[0], reverse=True)
    return ranges

def process_chunk_task(args):
    """
    Worker function to process a single chunk in a separate process.
    """
    (base_file_path, output_dir, group_name, row_indices, header_rows,
     max_cols, additional_sheets_config, main_sheet_name, add_sheet_map, is_xlsm, chunk_pattern, filename_suffix) = args

    try:
        # Load the OPTIMIZED base workbook
        chunk_wb = load_workbook(base_file_path, keep_vba=is_xlsm)

        # 1. Process Main Sheet
        if main_sheet_name in chunk_wb.sheetnames:
            dest_ws = chunk_wb[main_sheet_name]

            # Delete columns if max_cols is set
            if max_cols and dest_ws.max_column > max_cols:
                dest_ws.delete_cols(max_cols + 1, dest_ws.max_column - max_cols)

            # Delete rows not in this group
            ranges_to_delete = get_ranges_to_delete(dest_ws.max_row, row_indices, header_rows)
            for start, count in ranges_to_delete:
                dest_ws.delete_rows(start, count)
        else:
            print(f"Warning: Main sheet '{main_sheet_name}' missing in chunk processing.")

        # 2. Process Additional Sheets
        for i, add_sheet_conf in enumerate(additional_sheets_config):
            if i not in add_sheet_map:
                continue

            add_sheet_name = add_sheet_map[i]
            if add_sheet_name not in chunk_wb.sheetnames:
                continue

            add_ws = chunk_wb[add_sheet_name]

            add_filter_col = add_sheet_conf.get('filterColumnPosition', 1)
            add_header_rows = add_sheet_conf.get('headerRows', 1)
            add_max_cols = add_sheet_conf.get('maxColumnsToInclude')

            # Rename sheet to include group name
            sanitized_group = re.sub(r'[<>:"/\\|?*]', '_', group_name)
            new_sheet_title = f"{add_sheet_name} - {sanitized_group}"[:31]

            if new_sheet_title != add_sheet_name:
                 add_ws.title = new_sheet_title

            # Delete columns
            if add_max_cols and add_ws.max_column > add_max_cols:
                add_ws.delete_cols(add_max_cols + 1, add_ws.max_column - add_max_cols)

            # Identify rows to keep in additional sheet
            rows_to_keep = []
            current_row = 0

            # Scan filter column
            for row in add_ws.iter_rows(min_row=1, min_col=add_filter_col, max_col=add_filter_col):
                current_row += 1
                if current_row <= add_header_rows:
                    continue

                cell = row[0]
                val = cell.value
                val_str = str(val) if val is not None else ""

                key_from_row = val_str
                if chunk_pattern:
                    match = re.search(chunk_pattern, val_str)
                    if match:
                        key_from_row = match.group(1) if match.groups() else match.group(0)

                if key_from_row == group_name:
                    rows_to_keep.append(current_row)

            # If no rows match the group, remove the sheet entirely
            if not rows_to_keep:
                chunk_wb.remove(add_ws)
                continue

            # Delete rows
            ranges = get_ranges_to_delete(add_ws.max_row, rows_to_keep, add_header_rows)
            for start, count in ranges:
                add_ws.delete_rows(start, count)

        # --- CLEANUP TO PREVENT CORRUPTION WARNINGS ---
        cleanup_workbook(chunk_wb)

        # Save Chunk
        sanitized_group = re.sub(r'[<>:"/\\|?*]', '_', group_name)

        # Use custom suffix if provided, otherwise use current date
        suffix = filename_suffix if filename_suffix else datetime.datetime.now().strftime("%d.%m.%Y")

        ext = '.xlsm' if is_xlsm else '.xlsx'
        out_filename = f"{sanitized_group} - {suffix}{ext}"
        out_path = os.path.join(output_dir, out_filename)

        chunk_wb.save(out_path)
        chunk_wb.close()

        print(f"Created chunk: {out_filename}")
        return out_filename

    except Exception as e:
        print(f"Error processing chunk '{group_name}': {e}", file=sys.stderr)
        traceback.print_exc()
        return None

def process(input_path, output_dir, config_json):
    print(f"Starting processing of {input_path}")

    if not os.path.exists(input_path):
        print(f"Error: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    try:
        config = json.loads(config_json)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON config: {e}", file=sys.stderr)
        sys.exit(1)

    # Config extraction
    sheet_idx = config.get('sheetToChunkPosition', 1) - 1 # 0-based
    header_rows = config.get('headerRows', 1)
    split_col = config.get('splitColumnPosition', 1) # 1-based
    max_cols = config.get('maxColumnsToInclude')
    chunk_pattern = config.get('chunkNamePattern')
    filename_suffix = config.get('filenameSuffix')
    additional_sheets_config = config.get('additionalSheets', [])

    # --- PASS 1: Analyze Groups (Read-Only for speed) ---
    print("Analyzing file structure...")
    try:
        wb_reader = load_workbook(input_path, data_only=True, read_only=True)
    except Exception as e:
        print(f"Error loading workbook for analysis: {e}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)

    # Identify visible sheets to correctly map user indices
    visible_sheet_names = [s.title for s in wb_reader if s.sheet_state == 'visible']

    try:
        # Map user index (visible index) to actual sheet name
        main_sheet_name = visible_sheet_names[sheet_idx]
    except IndexError:
        print(f"Error: Visible sheet index {sheet_idx + 1} out of range. Available visible sheets: {len(visible_sheet_names)}", file=sys.stderr)
        sys.exit(1)

    ws_reader = wb_reader[main_sheet_name]

    groups = {} # key -> list of row indices
    current_group = None
    pending_rows = []

    row_counter = 0

    try:
        # iter_rows in read_only is a generator
        for row in ws_reader.iter_rows(min_row=1):
            row_counter += 1
            row_idx = row_counter

            if row_idx <= header_rows:
                continue

            # Get split value
            try:
                cell = row[split_col - 1] if (split_col - 1) < len(row) else None
                val = cell.value if cell else None
                val_str = str(val) if val is not None else ""
            except Exception as e:
                print(f"Warning: Error reading cell at row {row_idx}, col {split_col}: {e}")
                val_str = ""

            extracted_name = None
            if chunk_pattern:
                match = re.search(chunk_pattern, val_str)
                if match:
                    extracted_name = match.group(1) if match.groups() else match.group(0)
            else:
                extracted_name = val_str if val_str else None

            is_valid_key = bool(extracted_name)

            if not is_valid_key:
                pending_rows.append(row_idx)
                continue

            group_key = extracted_name

            # Flush pending rows to the current group (attach to next valid group)
            if pending_rows:
                target = group_key
                if target:
                    if target not in groups: groups[target] = []
                    groups[target].extend(pending_rows)
                pending_rows = []

            if group_key not in groups:
                groups[group_key] = []
            groups[group_key].append(row_idx)
            current_group = group_key

        # Flush remaining pending rows to the last group
        if pending_rows and current_group:
            groups[current_group].extend(pending_rows)

    except Exception as e:
        print(f"Error during row analysis: {e}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
    finally:
        wb_reader.close()

    # --- OPTIMIZATION: Create Base File ---
    print("Creating optimized base file (removing unused sheets)...")

    temp_base_path = ""
    is_xlsm = False
    add_sheet_map = {}

    try:
        # Check if input is macro-enabled to preserve VBA
        is_xlsm = input_path.lower().endswith(('.xlsm', '.xltm'))

        # IMPORTANT: keep_vba=True is required to preserve macros
        base_wb = load_workbook(input_path, keep_vba=is_xlsm)
        sheets_to_keep = set()

        # Keep Main Sheet
        if main_sheet_name in base_wb.sheetnames:
            sheets_to_keep.add(main_sheet_name)

        # Keep Additional Sheets (Resolve visible indices again for base_wb)
        # Note: base_wb might have different sheet objects but names match
        # We reuse visible_sheet_names from Pass 1 assuming structure hasn't changed

        for idx, conf in enumerate(additional_sheets_config):
            s_idx = conf.get('sheetIndex', 1) - 1
            if 0 <= s_idx < len(visible_sheet_names):
                s_name = visible_sheet_names[s_idx]
                add_sheet_map[idx] = s_name
                sheets_to_keep.add(s_name)
            else:
                print(f"Warning: Additional sheet index {s_idx + 1} out of range (visible sheets: {len(visible_sheet_names)})")

        # Remove unused sheets from base
        sheets_removed = 0
        for sheet_name in list(base_wb.sheetnames):
            if sheet_name not in sheets_to_keep:
                del base_wb[sheet_name]
                sheets_removed += 1

        print(f"Removed {sheets_removed} sheets. Keeping {len(base_wb.sheetnames)} sheets.")

        # --- CLEANUP TO PREVENT CORRUPTION WARNINGS ---
        cleanup_workbook(base_wb)

        # Save optimized base
        base_ext = os.path.splitext(input_path)[1]
        temp_base_path = os.path.join(output_dir, f"temp_base_{datetime.datetime.now().timestamp()}{base_ext}")
        base_wb.save(temp_base_path)
        base_wb.close()
    except Exception as e:
        print(f"Error creating optimized base file: {e}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)

    print(f"Optimized base file created. Starting parallel chunk generation for {len(groups)} groups...")

    # --- PASS 2: Generate Chunks in Parallel ---
    generated_files = []

    # Prepare tasks
    tasks = []
    for group_name, row_indices in groups.items():
        tasks.append((
            temp_base_path, # Use TEMP base path
            output_dir,
            group_name,
            row_indices,
            header_rows,
            max_cols,
            additional_sheets_config,
            main_sheet_name,
            add_sheet_map,
            is_xlsm,
            chunk_pattern,
            filename_suffix
        ))

    try:
        # Use ProcessPoolExecutor for CPU-bound tasks (XML parsing/writing)
        # Limit workers to avoid OOM with large files (e.g., 4 workers)
        max_workers = min(os.cpu_count() or 4, 4)
        print(f"Using {max_workers} worker processes.")

        with concurrent.futures.ProcessPoolExecutor(max_workers=max_workers) as executor:
            results = executor.map(process_chunk_task, tasks)

            for res in results:
                if res:
                    generated_files.append(res)

    except Exception as e:
        print(f"Critical error in parallel execution: {e}", file=sys.stderr)
        traceback.print_exc()
    finally:
        # Cleanup temp base file
        if temp_base_path and os.path.exists(temp_base_path):
            try:
                os.remove(temp_base_path)
                print("Cleaned up temp base file.")
            except Exception as e:
                print(f"Warning: Failed to remove temp base file: {e}", file=sys.stderr)

    print("JSON_RESULT:" + json.dumps(generated_files))

if __name__ == "__main__":
    # Required for PyInstaller to work with multiprocessing
    multiprocessing.freeze_support()

    if len(sys.argv) < 4:
        print("Usage: python slice_xlsx_for_chunks.py <input_file> <output_dir> <config_json>")
        sys.exit(1)

    process(sys.argv[1], sys.argv[2], sys.argv[3])
