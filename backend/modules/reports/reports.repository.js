const { supabase } = require('../../config/supabase');

async function createReportRequest({
  customerName,
  customerEmail,
  company,
  reportType,
  description,
  timeline,
  budget,
}) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('report_requests')
    .insert({
      customer_name: customerName,
      customer_email: customerEmail,
      company: company || null,
      report_type: reportType,
      description,
      timeline: timeline || null,
      budget_range: budget || null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error || !data) {
    const err = new Error(error?.message || 'Failed to persist report request');
    err.statusCode = 500;
    throw err;
  }

  return data.id;
}

module.exports = {
  createReportRequest,
};
