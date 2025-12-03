import { exec } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Helper to find LibreOffice executable based on OS
const getLibreOfficePath = async (): Promise<string> => {
  // 1. Try to find 'libreoffice' or 'soffice' in the system PATH first
  const commands = ['libreoffice', 'soffice'];
  for (const cmd of commands) {
    try {
      // Try to get version to check if command exists
      await execAsync(`${cmd} --version`);
      return cmd;
    } catch (e) {
      // Command not found in PATH, continue
    }
  }

  // 2. Fallback to standard installation paths if not in PATH
  const platform = os.platform();

  if (platform === 'darwin') {
    const commonPath = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
    try {
      await fs.access(commonPath);
      return `"${commonPath}"`;
    } catch {
      // Not found in standard location
    }
  }

  if (platform === 'win32') {
    const commonPaths = [
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    ];
    for (const p of commonPaths) {
      try {
        await fs.access(p);
        return `"${p}"`;
      } catch {
        continue;
      }
    }
  }

  // Default fallback if nothing works (will likely fail if not installed)
  return 'soffice';
};

// Helper to convert using LibreOffice (requires 'soffice' in PATH)
const convertWithLibreOffice = async (
  buffer: Buffer,
  originalName = '',
): Promise<Buffer> => {
  const tempDir = os.tmpdir();
  const safeName = originalName.replace(/[^a-zA-Z0-9.]/g, '_');
  const inputPath = path.join(tempDir, `temp_${Date.now()}_${safeName}`);

  try {
    await fs.writeFile(inputPath, buffer);

    const sofficePath = await getLibreOfficePath();

    // --headless: no UI
    // --convert-to xlsx: target format
    // --outdir: output directory
    const command = `${sofficePath} --headless --convert-to xlsx "${inputPath}" --outdir "${tempDir}"`;
    console.log(`🖥️ Executing system conversion: ${command}`);

    await execAsync(command);

    // LibreOffice names the output file based on input filename
    const outputFileName =
      path.basename(inputPath, path.extname(inputPath)) + '.xlsx';
    const expectedOutput = path.join(tempDir, outputFileName);

    const convertedBuffer = await fs.readFile(expectedOutput);

    // Cleanup
    await Promise.all([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(expectedOutput).catch(() => {}),
    ]);

    return convertedBuffer;
  } catch (error) {
    // Cleanup on error
    await fs.unlink(inputPath).catch(() => {});
    throw error;
  }
};

export { convertWithLibreOffice };
