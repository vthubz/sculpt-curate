'use client';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="hover:text-zinc-100"
      onClick={async () => {
        await createSupabaseBrowser().auth.signOut();
        router.push('/');
      }}
    >
      Sign out
    </button>
  );
}
