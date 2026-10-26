// Native command rejections are strings. Surface only fixed storage messages;
// arbitrary IPC/OS error text can contain paths, identifiers or key material.
const messages=new Set([
  'The encrypted message store is locked, damaged or changed in another window. Preserve it, unlock the system key store and sign in again.',
  'The saved encryption key exists, but encrypted history is missing from this Windows profile. Keep the original profile and history files; do not reset your keys.',
  'Encrypted history exists, but its saved encryption key is unavailable in this Windows profile. Keep the original files and sign in from the original Windows profile.',
  'The system key store could not be opened. Unlock your Windows session and try again. Existing encrypted history was preserved.',
  'Invalid encrypted message storage request.',
  'Identity storage is available only to the Hearth client.',
])
export function messageStorageError(error:unknown){
  const message=typeof error==='string'?error:error instanceof Error?error.message:''
  return new Error(messages.has(message)?message:'The local encrypted message store could not be opened or saved. Existing data was preserved. Close other Hearth windows and sign in again.')
}
