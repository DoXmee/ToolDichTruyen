import { describe, expect, it } from 'vitest';
import { compactWorkspaceZoomFactor, navigationAllowed } from '../../src/main/window';

describe('main renderer navigation boundary', () => {
  it('chỉ tin đúng renderer đóng gói, không tin mọi file:// cục bộ', () => {
    expect(navigationAllowed('file:///C:/Users/Public/attacker.html')).toBe(false);
    expect(navigationAllowed('file:///D:/Tool%20dich%20truyen/out/renderer/other.html')).toBe(false);
  });

  it('chỉ cho phép origin dev đã cấu hình', () => {
    expect(navigationAllowed('http://127.0.0.1:5173/index.html', 'http://127.0.0.1:5173')).toBe(true);
    expect(navigationAllowed('http://127.0.0.1:5174/index.html', 'http://127.0.0.1:5173')).toBe(false);
  });
});

describe('compact desktop workspace zoom', () => {
  it('only scales short content areas and keeps a readable lower bound', () => {
    expect(compactWorkspaceZoomFactor(940)).toBe(1);
    expect(compactWorkspaceZoomFactor(792)).toBe(1);
    expect(compactWorkspaceZoomFactor(684)).toBeCloseTo(0.863636, 5);
    expect(compactWorkspaceZoomFactor(320)).toBe(0.76);
    expect(compactWorkspaceZoomFactor(Number.NaN)).toBe(1);
  });
});
