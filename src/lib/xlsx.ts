// Minimal .xlsx writer: styled, printable sheets (fonts, fills, borders,
// merged cells, number formats, right-to-left, cell colors by value, print
// setup). No dependencies; the package is an uncompressed ZIP, which the
// Office Open XML format allows.

export type Rgb = string; // 'RRGGBB'
export type Edge = 'thin' | 'medium';

export interface CellStyle {
  font?: { name?: string; size?: number; bold?: boolean; color?: Rgb };
  fill?: Rgb;
  // left = side toward column A (on the right in a right-to-left sheet)
  border?: { left?: Edge; right?: Edge; top?: Edge; bottom?: Edge };
  h?: 'left' | 'center' | 'right';
  v?: 'top' | 'center' | 'bottom';
  wrap?: boolean;
  numFmt?: string;
}

export type CellValue = string | number | null | undefined;

interface Cell { value: CellValue; style?: CellStyle }

export interface PrintSetup {
  area?: [number, number, number, number]; // r1, c1, r2, c2
  fitWidth?: number;  // pages across (0 = no limit)
  fitHeight?: number; // pages down (0 = no limit)
  landscape?: boolean;
  gridLines?: boolean;
  centerH?: boolean;
  margin?: number; // inches, all sides
}

export class Sheet {
  readonly cells = new Map<number, Map<number, Cell>>();
  readonly widths = new Map<number, number>();
  readonly heights = new Map<number, number>();
  readonly merges: [number, number, number, number][] = [];
  // Cells in `range` whose text equals `text` get `fill` (stays correct
  // when the file is edited later)
  readonly highlights: { range: string; text: string; fill: Rgb }[] = [];
  print?: PrintSetup;

  constructor(public name: string, public rtl = false) {}

  set(r: number, c: number, value: CellValue, style?: CellStyle): void {
    let row = this.cells.get(r);
    if (!row) this.cells.set(r, (row = new Map()));
    row.set(c, { value, style });
  }

  get(r: number, c: number): Cell | undefined {
    return this.cells.get(r)?.get(c);
  }

  // Merge a block; every cell in it keeps `style` so borders draw all round
  merge(r1: number, c1: number, r2: number, c2: number, value: CellValue, style?: CellStyle): void {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) this.set(r, c, r === r1 && c === c1 ? value : null, style);
    if (r1 !== r2 || c1 !== c2) this.merges.push([r1, c1, r2, c2]);
  }
}

// ---------- helpers ----------

export const colName = (c: number): string => {
  let s = '';
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export const ref = (r: number, c: number): string => `${colName(c)}${r}`;
export const rangeRef = (r1: number, c1: number, r2: number, c2: number): string => `${ref(r1, c1)}:${ref(r2, c2)}`;

// Excel serial day number of a YYYY-MM-DD date
export const excelDate = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
};

// Characters XML 1.0 cannot carry are dropped
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
const esc = (s: string) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const argb = (rgb: Rgb) => 'FF' + rgb.replace('#', '').toUpperCase();

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// ---------- styles ----------

class Styles {
  private fonts: string[] = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'];
  private fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  private numFmts: string[] = [];
  private xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private dxfs: string[] = [];
  private cache = new Map<string, number>();

  private index(list: string[], xml: string): number {
    const i = list.indexOf(xml);
    if (i >= 0) return i;
    list.push(xml);
    return list.length - 1;
  }

  xf(s?: CellStyle): number {
    if (!s) return 0;
    const key = JSON.stringify(s);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;

    const f = s.font || {};
    const font = this.index(this.fonts,
      `<font>${f.bold ? '<b/>' : ''}<sz val="${f.size ?? 11}"/>${f.color ? `<color rgb="${argb(f.color)}"/>` : '<color theme="1"/>'}` +
      `<name val="${esc(f.name || 'Calibri')}"/><family val="2"/></font>`);
    const fill = s.fill
      ? this.index(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${argb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`)
      : 0;
    const b = s.border || {};
    const side = (name: string, e?: Edge) => (e ? `<${name} style="${e}"><color rgb="FF000000"/></${name}>` : `<${name}/>`);
    const border = this.index(this.borders,
      `<border>${side('left', b.left)}${side('right', b.right)}${side('top', b.top)}${side('bottom', b.bottom)}<diagonal/></border>`);
    let numFmt = 0;
    if (s.numFmt) {
      const code = `<numFmt numFmtId="{id}" formatCode="${esc(s.numFmt)}"/>`;
      let i = this.numFmts.findIndex(x => x === code);
      if (i < 0) { this.numFmts.push(code); i = this.numFmts.length - 1; }
      numFmt = 164 + i;
    }
    const align = s.h || s.v || s.wrap
      ? `<alignment${s.h ? ` horizontal="${s.h}"` : ''}${s.v ? ` vertical="${s.v}"` : ''}${s.wrap ? ' wrapText="1"' : ''}/>`
      : '';
    const xf = `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"` +
      `${numFmt ? ' applyNumberFormat="1"' : ''} applyFont="1"${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}` +
      `${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`;
    this.xfs.push(xf);
    const id = this.xfs.length - 1;
    this.cache.set(key, id);
    return id;
  }

  dxf(fill: Rgb): number {
    return this.index(this.dxfs,
      `<dxf><fill><patternFill patternType="solid"><fgColor rgb="${argb(fill)}"/><bgColor rgb="${argb(fill)}"/></patternFill></fill></dxf>`);
  }

  xml(): string {
    const list = (tag: string, items: string[]) => `<${tag} count="${items.length}">${items.join('')}</${tag}>`;
    return XML + `<styleSheet xmlns="${NS_MAIN}">` +
      (this.numFmts.length ? list('numFmts', this.numFmts.map((x, i) => x.replace('{id}', String(164 + i)))) : '') +
      list('fonts', this.fonts) + list('fills', this.fills) + list('borders', this.borders) +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      list('cellXfs', this.xfs) +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      list('dxfs', this.dxfs) +
      '</styleSheet>';
  }
}

// ---------- parts ----------

class Strings {
  private list: string[] = [];
  private map = new Map<string, number>();
  count = 0;
  id(s: string): number {
    this.count++;
    let i = this.map.get(s);
    if (i === undefined) { i = this.list.length; this.list.push(s); this.map.set(s, i); }
    return i;
  }
  xml(): string {
    // Like Excel: keep leading/trailing spaces only where there are some
    const items = this.list.map(s => `<si><t${/^\s|\s$/.test(s) ? ' xml:space="preserve"' : ''}>${esc(s)}</t></si>`).join('');
    return XML + `<sst xmlns="${NS_MAIN}" count="${this.count}" uniqueCount="${this.list.length}">${items}</sst>`;
  }
}

const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;

function sheetXml(sheet: Sheet, index: number, styles: Styles, strings: Strings): string {
  const rows = [...sheet.cells.keys(), ...sheet.heights.keys()];
  const maxRow = Math.max(1, ...rows);
  let maxCol = 1;
  sheet.cells.forEach(row => row.forEach((_, c) => { maxCol = Math.max(maxCol, c); }));
  const p = sheet.print;

  let xml = XML + `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`;
  if (p && (p.fitWidth !== undefined || p.fitHeight !== undefined)) xml += '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';
  xml += `<dimension ref="A1:${ref(maxRow, maxCol)}"/>`;
  xml += `<sheetViews><sheetView${sheet.rtl ? ' rightToLeft="1"' : ''}${index === 0 ? ' tabSelected="1"' : ''} workbookViewId="0"/></sheetViews>`;
  xml += '<sheetFormatPr defaultRowHeight="15"/>';

  if (sheet.widths.size) {
    xml += '<cols>' + [...sheet.widths.entries()].sort((a, b) => a[0] - b[0])
      .map(([c, w]) => `<col min="${c}" max="${c}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
  }

  xml += '<sheetData>';
  [...new Set(rows)].sort((a, b) => a - b).forEach(r => {
    const h = sheet.heights.get(r);
    xml += `<row r="${r}"${h ? ` ht="${h}" customHeight="1"` : ''}>`;
    const row = sheet.cells.get(r);
    if (row) {
      [...row.entries()].sort((a, b) => a[0] - b[0]).forEach(([c, cell]) => {
        const s = styles.xf(cell.style);
        const attrs = `r="${ref(r, c)}"${s ? ` s="${s}"` : ''}`;
        const v = cell.value;
        if (typeof v === 'number' && Number.isFinite(v)) xml += `<c ${attrs}><v>${v}</v></c>`;
        else if (typeof v === 'string' && v !== '') xml += `<c ${attrs} t="s"><v>${strings.id(v)}</v></c>`;
        else xml += `<c ${attrs}/>`;
      });
    }
    xml += '</row>';
  });
  xml += '</sheetData>';

  if (sheet.merges.length) {
    xml += `<mergeCells count="${sheet.merges.length}">` +
      sheet.merges.map(m => `<mergeCell ref="${rangeRef(...m)}"/>`).join('') + '</mergeCells>';
  }

  // One rule per text; the first matching rule wins
  const byRange = new Map<string, { text: string; fill: Rgb }[]>();
  sheet.highlights.forEach(h => {
    if (!h.text.trim()) return;
    const list = byRange.get(h.range) || [];
    if (!list.some(x => x.text === h.text)) list.push({ text: h.text, fill: h.fill });
    byRange.set(h.range, list);
  });
  let priority = 1;
  byRange.forEach((list, range) => {
    xml += `<conditionalFormatting sqref="${range}">` + list.map(h =>
      `<cfRule type="cellIs" dxfId="${styles.dxf(h.fill)}" priority="${priority++}" operator="equal">` +
      `<formula>${esc(`"${h.text.replace(/"/g, '""')}"`)}</formula></cfRule>`).join('') + '</conditionalFormatting>';
  });

  if (p) {
    if (p.gridLines || p.centerH) xml += `<printOptions${p.centerH ? ' horizontalCentered="1"' : ''}${p.gridLines ? ' gridLines="1"' : ''}/>`;
    const m = p.margin ?? 0.5;
    xml += `<pageMargins left="${m}" right="${m}" top="${m}" bottom="${m}" header="0" footer="0"/>`;
    xml += `<pageSetup paperSize="9" orientation="${p.landscape ? 'landscape' : 'portrait'}"` +
      `${p.fitWidth !== undefined ? ` fitToWidth="${p.fitWidth}"` : ''}${p.fitHeight !== undefined ? ` fitToHeight="${p.fitHeight}"` : ''}/>`;
  }
  return xml + '</worksheet>';
}

function workbookXml(sheets: Sheet[]): string {
  const names = sheets.map((s, i) => (s.print?.area
    ? `<definedName name="_xlnm.Print_Area" localSheetId="${i}">${esc(quoteSheet(s.name))}!${absRange(s.print.area)}</definedName>`
    : '')).join('');
  return XML + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><workbookPr/><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
    sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    `</sheets>${names ? `<definedNames>${names}</definedNames>` : ''}</workbook>`;
}

const absRange = ([r1, c1, r2, c2]: [number, number, number, number]) =>
  `$${colName(c1)}$${r1}:$${colName(c2)}$${r2}`;

// Sheet names: at most 31 characters, none of []:*?/\ and unique
export const safeSheetName = (name: string, taken: string[] = []): string => {
  const base = name.replace(/[[\]:*?/\\]/g, '-').replace(/^'+|'+$/g, '').slice(0, 31) || 'Sheet';
  let out = base;
  for (let n = 2; taken.includes(out); n++) out = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  return out;
};

export function buildXlsx(sheets: Sheet[], opts: { title?: string; date?: Date } = {}): Uint8Array {
  const styles = new Styles();
  const strings = new Strings();
  const sheetParts = sheets.map((s, i) => sheetXml(s, i, styles, strings));
  const when = (opts.date || new Date()).toISOString().replace(/\.\d+Z$/, 'Z');

  const files: [string, string][] = [
    ['[Content_Types].xml', XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>'],
    ['_rels/.rels', XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>'],
    ['docProps/core.xml', XML +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `${opts.title ? `<dc:title>${esc(opts.title)}</dc:title>` : ''}<dc:creator>ShiftMaster</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified>` +
      '</cp:coreProperties>'],
    ['docProps/app.xml', XML +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ShiftMaster</Application></Properties>'],
    ['xl/workbook.xml', workbookXml(sheets)],
    ['xl/_rels/workbook.xml.rels', XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
      '</Relationships>'],
    ...sheetParts.map((xml, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, xml]),
    ['xl/styles.xml', styles.xml()],
    ['xl/sharedStrings.xml', strings.xml()],
  ];
  return zip(files.map(([name, text]) => [name, new TextEncoder().encode(text)]), opts.date || new Date());
}

// ---------- ZIP (stored, no compression) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export const crc32 = (data: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export function zip(files: [string, Uint8Array][], date: Date): Uint8Array {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  files.forEach(([name, data]) => {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);      // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  });

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);

  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  parts.forEach(p => { out.set(p, pos); pos += p.length; });
  return out;
}
