import { useQuery } from '@tanstack/react-query';
import { readDocx, type Docx } from '@whereas/core';
import { api } from '../api';

/** Loads and parses a Word document from the server. */
export function useDocx(path: string | null, cacheKey: unknown) {
  return useQuery<Docx>({
    queryKey: ['docx', path, cacheKey],
    enabled: !!path,
    staleTime: Infinity,
    queryFn: async () => readDocx(await api.bytes(path!)),
  });
}
