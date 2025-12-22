import fs from 'fs/promises';
import path from 'path';

import { collectFilePaths } from './collect-file-paths.mjs';
import { convertDocViaHtmlToTxtAdvanced } from './convert-doc-to-txt.mjs';

/**
 * Converts all docs and preserves structure under destRoot
 */
async function processFolderAllDocs(srcRoot: string, destRoot: string) {
  const filePaths = await collectFilePaths(srcRoot);

  for (const srcPath of filePaths) {
    const relativePath = path.relative(srcRoot, srcPath);
    const destPath = path.join(destRoot, relativePath + '.txt'); // .docx.txt
    const destDir = path.dirname(destPath);

    await fs.mkdir(destDir, { recursive: true });

    try {
      // const text = await convertDocViaRawTextToTxt(srcPath);
      const { text } = await convertDocViaHtmlToTxtAdvanced(srcPath);
      await fs.writeFile(destPath, text, 'utf8');
      console.log(`✅ Processed: ${relativePath}`);
    } catch (err) {
      console.error(`❌ Failed: ${relativePath}`, err);
    }
  }
}

export { processFolderAllDocs };
