import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

const DEFAULT = {
  plan: null,
  historyDays: null,
  advancedStats: false,
  maxMembers: null,
  maxActiveHabits: null,
  loading: true,
};

export default function usePlanInfo(companyId) {
  const [info, setInfo] = useState(DEFAULT);
  const lastCompanyId = useRef(null);

  useEffect(() => {
    if (!companyId) return;
    // Mismo companyId → no volver a pedir
    if (companyId === lastCompanyId.current) return;
    lastCompanyId.current = companyId;

    let cancelled = false;
    setInfo((prev) => ({ ...prev, loading: true }));

    supabase.rpc('get_company_plan_info', { p_company_id: companyId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setInfo({ ...DEFAULT, loading: false });
        return;
      }
      setInfo({
        plan: data.plan ?? null,
        historyDays: data.history_days ?? null,
        advancedStats: data.advanced_stats ?? false,
        maxMembers: data.max_members ?? null,
        maxActiveHabits: data.max_active_habits ?? null,
        loading: false,
      });
    });

    return () => { cancelled = true; };
  }, [companyId]);

  return info;
}
