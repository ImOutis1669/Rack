import { dark, light, palette } from './colors';
import { font, ROLES, textStyle } from './type';

describe('colours', () => {
  it('follow DESIGN.md and the system scheme', () => {
    expect(palette('dark')).toBe(dark);
    expect(palette('light')).toBe(light);
    expect(palette(null)).toBe(light);
    expect(dark.background).toBe('#000000'); // OLED black, deliberate
    expect(light.accent).toBe('#248A3D');
    expect(dark.accent).toBe('#30D158');
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });
});

describe('type', () => {
  it('uses the Neue Montreal file per weight, never a faked weight', () => {
    expect(font('bold', true)).toEqual({ fontFamily: 'NeueMontreal-Bold' });
    expect(font('medium', true)).not.toHaveProperty('fontWeight');
  });

  it('falls back to SF Pro weights without the font files', () => {
    expect(font('bold', false)).toEqual({ fontWeight: '700' });
    expect(font('medium', false)).toEqual({ fontWeight: '600' });
    expect(textStyle('body', false)).toMatchObject({ fontSize: ROLES.body.size, fontWeight: '400' });
  });
});
