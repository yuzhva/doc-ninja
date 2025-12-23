import uno
import os
import sys
import time
import subprocess
import shutil
from com.sun.star.beans import PropertyValue

def convert_to_static(input_path, output_path):
    # 1. Setup environment for Headless LibreOffice
    soffice_bin = os.environ.get('LIBREOFFICE_BINARY', 'soffice')

    # Use a unique user profile for this process to avoid locks and permission issues
    # This is critical in Docker/Server environments
    pid = os.getpid()
    user_profile_dir = f"/tmp/lo_profile_{pid}"
    user_installation_url = f"file://{user_profile_dir}"

    # Port 2002 is standard, but in a real concurrent env, you might want this dynamic
    port = 2002
    connection_string = f"socket,host=localhost,port={port};urp;"

    print(f"Starting LibreOffice on port {port} with profile {user_profile_dir}...")

    # Start LibreOffice with specific flags to ensure headless operation
    args = [
        soffice_bin,
        f"-env:UserInstallation={user_installation_url}",
        '--headless',
        f'--accept={connection_string}',
        '--nofirststartwizard',
        '--nologo',
        '--nodefault'
    ]

    soffice_process = subprocess.Popen(args)

    # 2. Connect to LibreOffice (Retry Loop)
    # It takes time for LO to start and open the socket.
    ctx = None
    resolver = None

    localContext = uno.getComponentContext()
    resolver = localContext.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", localContext )

    max_retries = 30 # Try for ~15 seconds
    for i in range(max_retries):
        try:
            ctx = resolver.resolve(f"uno:{connection_string}StarOffice.ComponentContext")
            if ctx:
                print("Connected to LibreOffice.")
                break
        except Exception:
            # Check if process is still alive
            if soffice_process.poll() is not None:
                raise Exception(f"LibreOffice process died unexpectedly with code {soffice_process.returncode}")
            time.sleep(0.5)

    if not ctx:
        # Cleanup before raising
        soffice_process.terminate()
        if os.path.exists(user_profile_dir):
            shutil.rmtree(user_profile_dir, ignore_errors=True)
        raise Exception("Timed out connecting to LibreOffice UNO bridge")

    try:
        smgr = ctx.ServiceManager
        desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)

        # 3. Load the file (Hidden)
        input_url = "file://" + os.path.abspath(input_path)
        props = [PropertyValue("Hidden", 0, True, 0)]
        doc = desktop.loadComponentFromURL(input_url, "_blank", 0, tuple(props))

        if not doc:
            raise Exception("Failed to load document")

        # 4. Iterate over all sheets and flatten formulas
        sheets = doc.getSheets()
        for i in range(sheets.getCount()):
            sheet = sheets.getByIndex(i)

            # Create a cursor to select the used area
            cursor = sheet.createCursor()
            cursor.gotoEndOfUsedArea(True)

            # THE MAGIC: Get Data (Values) and Set Data (Values)
            # This overwrites formulas with their calculated results
            # while preserving all formatting (colors, borders, conditional formatting)
            data = cursor.getDataArray()
            cursor.setDataArray(data)

        # 5. Save as XLSX
        # We use .xlsx because it is the most compatible format for static data.
        # Even if we wanted .xlsm, LibreOffice often saves as standard XML structure
        # if macros are not perfectly preserved, causing Excel to throw "Extension Mismatch" errors.
        output_url = "file://" + os.path.abspath(output_path)
        save_props = [
            PropertyValue("FilterName", 0, "Calc MS Excel 2007 XML", 0),
            PropertyValue("Overwrite", 0, True, 0)
        ]
        doc.storeToURL(output_url, tuple(save_props))
        doc.close(True)

        print(f"Successfully converted {input_path} to {output_path}")

    finally:
        # 6. Cleanup
        # Terminate LO
        if soffice_process.poll() is None:
            soffice_process.terminate()
            soffice_process.wait()

        # Remove temp profile
        if os.path.exists(user_profile_dir):
            shutil.rmtree(user_profile_dir, ignore_errors=True)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 convert_xlsb.py <input_file> <output_file>")
        sys.exit(1)

    convert_to_static(sys.argv[1], sys.argv[2])
