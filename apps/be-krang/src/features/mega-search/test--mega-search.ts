import { testMegaSearch } from './mega-search.ts';
import path from 'path';

testMegaSearch({ rootDirectory: path.join(__dirname, 'documents') });
