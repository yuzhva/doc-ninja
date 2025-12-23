#!/bin/bash
# filepath: /Users/yuzhva/webapps/work/80/doc-ninja/apps/be-krang/scripts/build-python.sh

# Ensure the output directory exists
mkdir -p dist/python-scripts

echo "📦 Setting up temporary Python environment..."
# Create a virtual environment to isolate build dependencies
python3 -m venv .venv-build
source .venv-build/bin/activate

echo "⬇️ Installing build dependencies..."
# Install PyInstaller and the libraries used by your script (openpyxl)
pip install pyinstaller openpyxl

echo "🔨 Compiling Python script..."
# Compile the Python script into a standalone executable
pyinstaller --onefile \
            --distpath dist/python-scripts \
            --name convert_xlsx_to_static \
            src/python-scripts/convert_xlsx_to_static.py

pyinstaller --onefile \
            --distpath dist/python-scripts \
            --name slice_xlsx_for_chunks \
            src/python-scripts/slice_xlsx_for_chunks.py

echo "🧹 Cleaning up build artifacts..."
# Deactivate virtual env and remove temporary files
deactivate
rm -rf .venv-build build convert_xlsx_to_static.spec slice_xlsx_for_chunks.spec

echo "✅ Python build complete."
