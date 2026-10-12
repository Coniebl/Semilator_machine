import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lttwpfmyojmiqsmecbjt.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_7iU7zfF7a-DgG6wjkh6NNA_Ikc_kxVd';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

