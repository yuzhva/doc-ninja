import sys
import openpyxl
import os

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

    print(f"Saving static workbook to {output_path}...")
    wb.save(output_path)
    print("Done.")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 convert_xlsx_static.py <input_file> <output_file>")
        sys.exit(1)

    convert_to_static(sys.argv[1], sys.argv[2])
