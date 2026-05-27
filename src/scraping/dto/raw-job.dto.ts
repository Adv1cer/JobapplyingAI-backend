export interface RawJob {
  title: string;
  company: string;
  location: string;
  salary?: string;
  jobType?: string;
  description?: string;
  url: string;
  source: string;
  postedAt?: string;
  hrEmails?: string[];
}

export interface CompanyInfo {
  taxId?: string;
  businessType?: string;
  status?: string;         // 'ยังดำเนินกิจการอยู่' | 'เลิกกิจการ' | ...
  registrationDate?: string;
  registeredCapital?: string;
  address?: string;
  website?: string;
  found: boolean;
}
