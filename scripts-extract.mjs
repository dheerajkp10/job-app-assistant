import mammoth from 'mammoth';
import { readFileSync } from 'fs';
const buf = readFileSync('/Users/dheerajkumarparas/Downloads/Dheeraj_Kumar_Paras_Master_Resume_2026_vF.docx');
const r = await mammoth.extractRawText({ buffer: buf });
console.log(r.value);
