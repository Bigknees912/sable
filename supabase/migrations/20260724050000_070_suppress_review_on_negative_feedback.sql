-- Audit fix I4: a customer who leaves negative feedback could still get the
-- automated "please leave us a Google review" text, because the seeded
-- review automation fires on job completion + delay unconditionally and
-- nothing linked it to feedback.
--
-- This adds an AFTER INSERT trigger on `feedback`: when a negative-sentiment
-- row lands, cancel any still-pending review-request automation_runs for the
-- same customer (and same job when the feedback is job-specific). Cancelling
-- the queued run is enough - run_due_automations only sends rows still in
-- 'pending', so a 'cancelled' row is skipped. Positive/neutral feedback is
-- left alone; the review request still goes out for happy customers.
--
-- "Review-request" runs are identified by their automation's action: a
-- send_sms whose message references a review (the {{review_link}} variable
-- or the word "review"). This matches the seeded default and any owner-made
-- review rule without needing a dedicated flag column.

create or replace function public.cancel_review_on_negative_feedback()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if new.sentiment is distinct from 'negative' then
    return new;
  end if;

  update public.automation_runs ar
     set status = 'cancelled'
    from public.automations a
   where ar.automation_id = a.id
     and ar.company_id = new.company_id
     and ar.status = 'pending'
     and ar.customer_id is not distinct from new.customer_id
     and (new.job_id is null or ar.job_id is not distinct from new.job_id)
     and a.action_type = 'send_sms'
     and (
       (a.action_config->>'message') ilike '%{{review_link}}%'
       or (a.action_config->>'message') ilike '%review%'
     );

  return new;
end;
$$;

drop trigger if exists feedback_cancel_review on public.feedback;
create trigger feedback_cancel_review
  after insert on public.feedback
  for each row
  execute function public.cancel_review_on_negative_feedback();
