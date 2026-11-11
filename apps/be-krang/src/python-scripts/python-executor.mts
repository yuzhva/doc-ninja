import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const executePythonScript = async (
  scriptName: string,
  args: string[],
  options: {
    onLog?: (message: string) => void;
    onError?: (message: string) => void;
  } = {},
): Promise<void> => {
  const binaryName =
    process.platform === 'win32' ? `${scriptName}.exe` : scriptName;

  // Resolve paths relative to this file to avoid issues with process.cwd() in Electron
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // 1. Try to find compiled binary (Production / Bundled)
  // In prod bundle: dist/cjs/index.cjs -> __dirname is dist/cjs
  // Binaries are in: dist/python-scripts/<script>/ (PyInstaller --onedir)
  const binaryPath = path.resolve(
    __dirname,
    '../python-scripts',
    scriptName,
    binaryName,
  );

  // 2. Fallback to source script (Development)
  // In dev: src/python-scripts/python-executor.mts -> __dirname is src/python-scripts
  const sourceScriptPath = path.join(__dirname, `${scriptName}.py`);

  let command = 'python3';
  let finalArgs = [
    '-u', // NOTE: show logs
    sourceScriptPath,
    ...args,
  ];

  if (existsSync(sourceScriptPath)) {
    console.log(`Using Python script: ${sourceScriptPath}`);
  } else if (existsSync(binaryPath)) {
    console.log(`Using compiled binary: ${binaryPath}`);
    command = binaryPath;
    finalArgs = args;
  } else {
    console.warn(`⚠️ Python script or binary not found for ${scriptName}`);
    console.warn(`Checked source: ${sourceScriptPath}`);
    console.warn(`Checked binary: ${binaryPath}`);
  }

  console.log(`Spawning python process: ${scriptName}`);

  return new Promise<void>((resolve, reject) => {
    const pythonProcess = spawn(command, finalArgs, { env: process.env });

    pythonProcess.stdout.on('data', (data) => {
      const str = data.toString();
      if (options.onLog) {
        options.onLog(str);
      } else {
        console.log(`Python [${scriptName}]: ${str.trim()}`);
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      const str = data.toString();
      if (options.onError) {
        options.onError(str);
      } else {
        console.error(`Python Error [${scriptName}]: ${str}`);
      }
    });

    // The process could not start (missing binary, no permission, …): without
    // a listener this 'error' is thrown and takes the whole backend down
    pythonProcess.on('error', (error) => {
      reject(
        new Error(
          `Python script ${scriptName} failed to start: ${error.message}`,
        ),
      );
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`Python script ${scriptName} exited with code ${code}`),
        );
    });
  });
};

export { executePythonScript };
