/**
 * Transforms file name/path by either replacing the extension or appending a new one
 * @param filePath - Original file name or path
 * @param newExtension - New extension to add (with or without leading dot)
 * @param mode - 'replace' to replace existing extension, 'append' to add after existing extension
 * @returns Transformed file name/path
 * 
 * @example
 * transformFileExtension('document.doc', '.txt', 'append') // 'document.doc.txt'
 * transformFileExtension('document.doc', '.txt', 'replace') // 'document.txt'
 * transformFileExtension('document.doc', 'txt', 'append') // 'document.doc.txt'
 */
export function transformFileExtension(
  filePath: string,
  newExtension: string,
  mode: 'replace' | 'append' = 'append'
): string {
  // Ensure extension has leading dot
  const normalizedExtension = newExtension.startsWith('.') ? newExtension : `.${newExtension}`;
  
  if (mode === 'replace') {
    return filePath.replace(/\.[^/.]+$/, normalizedExtension);
  }
  
  // Default: append mode
  return filePath + normalizedExtension;
}

/**
 * Convenience function for appending extension (preserves original)
 */
export function appendExtension(filePath: string, newExtension: string): string {
  return transformFileExtension(filePath, newExtension, 'append');
}

/**
 * Convenience function for replacing extension
 */
export function replaceExtension(filePath: string, newExtension: string): string {
  return transformFileExtension(filePath, newExtension, 'replace');
}
