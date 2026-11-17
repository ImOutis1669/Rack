// Photos for multipart uploads. In Expo SDK 58 the global fetch is Expo's own (WinterCG), which
// only accepts real file objects in FormData: React Native's `{ uri, name, type }` parts fail
// with "Unsupported FormDataPart implementation" (found trying the profile photo in Expo Go).
// expo-file-system's File implements Blob (name, type, bytes()), so it uploads as a file.
import type { UploadFile } from '@rack/shared/client';
import { File } from 'expo-file-system';

export function pickedFile(uri: string): UploadFile {
  return new File(uri);
}
