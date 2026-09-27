import { describe, expect, it } from 'vitest';
import { nativeViewsOccluded, occludeNativeViews } from './native-occlusion';

describe('native view occlusion', () => {
  it('hides native views while any overlay is open', () => {
    expect(nativeViewsOccluded()).toBe(false);
    const menu = occludeNativeViews();
    const dialog = occludeNativeViews();
    expect(nativeViewsOccluded()).toBe(true);
    menu();
    expect(nativeViewsOccluded()).toBe(true);
    dialog();
    expect(nativeViewsOccluded()).toBe(false);
  });

  it('ignores a repeated release, so one overlay cannot uncover another', () => {
    const menu = occludeNativeViews();
    const dialog = occludeNativeViews();
    menu();
    menu();
    expect(nativeViewsOccluded()).toBe(true);
    dialog();
    expect(nativeViewsOccluded()).toBe(false);
  });
});
