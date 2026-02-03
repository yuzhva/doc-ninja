import sys
import openpyxl
import os
from openpyxl.worksheet.views import Selection

def cleanup_workbook(wb):
    print("Cleaning up workbook links and structure...")

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
            should_keep = False

            if not dn.value:
                should_keep = False
            elif '#REF!' in dn.value:
                should_keep = False
            elif '[' in dn.value and ']' in dn.value:
                should_keep = False

            if should_keep:
                valid_names.append(dn)
        wb.defined_names.definedName = valid_names

    # 4. Remove Tables
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
        wb.active = 0

    for ws in wb:
        ws.sheet_view.topLeftCell = 'A1'
        ws.sheet_view.selection = [Selection(activeCell='A1', sqref='A1')]

def convert_tables_to_standard(ws):
    """
    !IMPORTANT - the styles of tables which are having Power Query connection - are NOT preserved
    Convert Power Query tables (queryTable) to standard tables within a worksheet.
    This simulates 'Unlink from Data Source' to preserve visual styles while removing bindings.
    """
    if hasattr(ws, 'tables'):
        for table in ws.tables.values():
            # Remove 'queryTable' type to make it a standard table
            if hasattr(table, 'tableType') and table.tableType == 'queryTable':
                table.tableType = None

            # Remove connection bindings references
            if hasattr(table, 'connectionId'):
                table.connectionId = None

def convert_to_static(input_path, output_path):
    print(f"Loading workbook from {input_path}...")

    # 1. Load the workbook normally to preserve styles, conditional formatting, and structure
    # keep_vba=True ensures we don't strip macros if they exist (though we are targeting xlsx)
    wb = openpyxl.load_workbook(input_path, keep_vba=True)

    # 2. Load a second instance with data_only=True
    # This tells openpyxl to read the *cached values* that Excel calculated and saved,
    # instead of the formula string.
    wb_values = openpyxl.load_workbook(input_path, data_only=True, keep_vba=True)

    print("Flattening formulas to static values...")

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        ws_values = wb_values[sheet_name]

        # Fix: Convert Power Query tables to standard tables to preserve styles
        convert_tables_to_standard(ws)

        # Iterate through all cells in the sheet
        for row in ws.iter_rows():
            for cell in row:
                # Check if the cell contains a formula
                # openpyxl marks formulas with data_type='f' or strings starting with '='
                if cell.data_type == 'f' or (isinstance(cell.value, str) and cell.value.startswith('=')):
                    # Get the calculated value from the data_only workbook
                    # We use cell.coordinate (e.g. 'A1') to map between the two instances
                    cached_value = ws_values[cell.coordinate].value

                    # Overwrite the formula with the static value
                    cell.value = cached_value

                    # We do NOT reset the style. The original style from 'wb' is preserved.

    # --- CLEANUP TO REMOVE WORKBOOK LINKS ---
    # cleanup_workbook(wb)

    print(f"Saving static workbook to {output_path}...")
    wb.save(output_path)
    print("Done.")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 convert_xlsx_static.py <input_file> <output_file>")
        sys.exit(1)

    convert_to_static(sys.argv[1], sys.argv[2])
