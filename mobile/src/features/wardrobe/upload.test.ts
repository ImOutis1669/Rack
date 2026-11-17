import { toUpload } from './upload';

describe('toUpload', () => {
  it('keeps a usable name and type', () => {
    expect(toUpload({ uri: 'file:///a.jpg', fileName: 'IMG_1.JPG', mimeType: 'image/jpeg' }, 0)).toEqual({
      uri: 'file:///a.jpg',
      name: 'IMG_1.JPG',
      type: 'image/jpeg',
    });
  });
  it('falls back to a JPEG name and type for HEIC or missing values', () => {
    expect(toUpload({ uri: 'file:///b', fileName: 'IMG_2.HEIC', mimeType: 'image/heic' }, 1)).toEqual({
      uri: 'file:///b',
      name: 'photo-2.jpg',
      type: 'image/jpeg',
    });
    expect(toUpload({ uri: 'file:///c' }, 2)).toMatchObject({ name: 'photo-3.jpg', type: 'image/jpeg' });
  });
});
