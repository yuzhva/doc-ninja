import path from 'path';

const root = process.cwd();

const runtimePathById = {
  // Relative to executable project
  root,

  src: path.join(root, 'src'),
};

export { runtimePathById };
