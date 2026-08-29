import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://grszaitpgnyrbxktxauc.supabase.co';
const supabaseKey = 'sb_publishable_6Ndppbw2HKqwb0x9s3TN5A_Uhm3Oa1F';

window.finmeiSupabase = createClient(supabaseUrl, supabaseKey);