import path from 'path';

const root = process.cwd();

const runtimePathById = {
  // Relative to executable project
  root,

  src: path.join(root, 'src'),
  dist: path.join(root, 'dist'),
  assets: path.join(root, 'assets'),
  // assets: path.join(root, 'assets/demo--extract-info'),
  // assets: path.join(root, 'assets/demo--process-data'),
};

export { runtimePathById };
