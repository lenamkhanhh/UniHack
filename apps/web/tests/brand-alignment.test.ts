import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('WOW-F17: Brand Alignment to MissionPay & Footer Typo Fix', () => {
  const appDir = path.resolve(process.cwd(), 'app');

  function getAllFiles(dir: string): string[] {
    let files: string[] = [];
    const list = fs.readdirSync(dir);
    for (const item of list) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        files = files.concat(getAllFiles(fullPath));
      } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it('contains zero occurrences of "Guarded Agent Economy" across all app routes', () => {
    const files = getAllFiles(appDir);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toContain('Guarded Agent Economy');
    }
  });

  it('contains zero occurrences of "UNIHAX STAGE CONSOLE" across all app routes', () => {
    const files = getAllFiles(appDir);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toContain('UNIHAX STAGE CONSOLE');
    }
  });

  it('unifies brand header to "MissionPay" and footer to "MissionPay · Avalanche Fuji"', () => {
    const layout = fs.readFileSync(path.resolve(process.cwd(), 'app/layout.tsx'), 'utf8');
    expect(layout).toContain('MissionPay');

    const stagePage = fs.readFileSync(path.resolve(process.cwd(), 'app/stage/page.tsx'), 'utf8');
    expect(stagePage).toContain('MissionPay · Avalanche Fuji');

    const bankrPage = fs.readFileSync(path.resolve(process.cwd(), 'app/bankr/page.tsx'), 'utf8');
    expect(bankrPage).toContain('MissionPay · Avalanche Fuji');

    const arenaStagePage = fs.readFileSync(path.resolve(process.cwd(), 'app/arena/stage/page.tsx'), 'utf8');
    expect(arenaStagePage).toContain('MissionPay · Avalanche Fuji');

    const verifyPage = fs.readFileSync(path.resolve(process.cwd(), 'app/verify/[missionId]/page.tsx'), 'utf8');
    expect(verifyPage).toContain('MissionPay · Avalanche Fuji');
  });
});
