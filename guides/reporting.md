# reporting: bulk daily CSV reports

The Reporting API generates daily CSV files for a report type once a job exists. Use it for data Analytics cannot slice, or for full history. It uses no Data API quota.

The workflow:

1. List report types.
2. Create a job for one type. This is gated.
3. Wait. The first report shows up 24 to 48 hours later, then one per day.
4. List the job's reports and download each `downloadUrl`.

```js run
const types = await yt.reporting.reportTypes.list({});
const jobs = await yt.reporting.jobs.list({});
return { types: types.reportTypes.map((t) => t.id), jobs: jobs.jobs ?? [] };
```

Common types: `channel_basic_a3` (daily views, watch time, likes), `channel_traffic_source_a3`, `channel_device_os_a3`, `channel_demographics_a1`, `channel_combined_a3`.

```js
const job = await yt.reporting.jobs.create({}, { reportTypeId: "channel_basic_a3", name: "basic" }, { confirm: true });
const { reports = [] } = await yt.reporting.jobs.reports.list({ jobId: job.id });
const latest = reports.sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
const { csv, totalChars, truncated } = await yt.reporting.download(latest.downloadUrl, { maxChars: 200000 });
```

`yt.reporting.download` returns the CSV text, capped at 50,000 characters unless you pass `maxChars`. Parse and aggregate it in code and return the summary, since the execute result is capped at 100 KB.

Deleting a job (`jobs.delete`) is gated.
