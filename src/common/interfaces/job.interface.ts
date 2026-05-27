export interface NormalizedJob {
  id: string;
  source: string;
  externalId?: string;
  title: string;
  company: string;
  location: string;
  description: string;
  skills: string[];
  salary?: string;
  jobType?: string;
  remote?: boolean;
  url: string;
  hrEmails?: string[];
  postedAt?: string;
  createdAt: Date;
}

export interface JobMatchResult {
  matchScore: number;
  missingSkills: string[];
  strengths: string[];
  summary: string;
  coverLetter?: string;
}

export interface CompanyInfo {
  taxId?: string;
  businessType?: string;
  status?: string;
  registrationDate?: string;
  registeredCapital?: string;
  address?: string;
  website?: string;
  found: boolean;
}
