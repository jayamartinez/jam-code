/** Mirrors the runtime: first letters of the first two words, else two letters. */
export const initialsOf = (name: string) => {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? '').slice(0, 2);
  return (letters || '··').toUpperCase();
};
