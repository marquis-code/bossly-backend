export interface CampusDefinition {
  code: string;
  name: string;
  shortName: string;
  city: string;
  slug: string;
}

export const LAGOS_CAMPUSES: CampusDefinition[] = [
  { code: 'UNILAG', name: 'University of Lagos', shortName: 'UNILAG', city: 'Lagos', slug: 'unilag' },
  { code: 'CMUL', name: 'College of Medicine, University of Lagos', shortName: 'CMUL', city: 'Lagos', slug: 'cmul' },
];

export function campusByCode(code?: string | null): CampusDefinition | null {
  if (!code) return null;
  return LAGOS_CAMPUSES.find((campus) => campus.code.toUpperCase() === code.trim().toUpperCase()) || null;
}
