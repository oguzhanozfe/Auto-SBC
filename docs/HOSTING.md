# Hosting decision — 10 September 2026

Auto-SBC can run remotely, but the current release is a local private beta. It
must not be exposed publicly with its existing unauthenticated, single-user API.
No cloud deployment or club-data upload has been performed.

## Measured workload

`scripts/benchmark_hosting.py` runs a synthetic pool in its own process without
reading an EA account. With 3,000 candidates and a five-second solve budget:

| Case | Peak process memory | Wall time | Result |
| --- | ---: | ---: | --- |
| Rating only | 156.1 MiB | 0.412 s | Optimal within the supplied pool |
| Rating plus 33 chemistry, flexible positions | 934.3 MiB | 4.845 s | Optimal within the supplied pool |

These are local macOS measurements, with the two processes run concurrently.
They are neither cloud benchmarks nor memory upper bounds. The HTTP server,
catalog, larger pools and concurrent users add further requirements.

## Options

| Host | Free offer and qualifications | Decision |
| --- | --- | --- |
| Render | 512 MB and 0.1 CPU; sleeps after 15 minutes; storage is ephemeral. Free use without a payment method is documented | Small demo only. Do not promise the full solver fits |
| Cloud Run | Monthly request-based allowances include 180,000 vCPU-seconds, 360,000 GiB-seconds and two million requests; a billing account is required and overages or adjacent services can cost money | Preferred managed private beta after transport and access changes |
| Oracle Always Free A1 | Current resource documentation gives 2 OCPU/12 GB and 200 GB combined boot/block storage for free tenancies; card verification and regional capacity are required | Best candidate when zero recurring compute cost matters more than VM maintenance |
| Hugging Face Spaces | CPU Basic lists 2 vCPU/16 GB without hourly charges, but creating a new Docker/Gradio compute Space now requires a paid plan | Not a genuinely free new deployment under the current rules |

Sources: [Render plans](https://render.com/docs/compute-plans) and
[free-service limitations](https://render.com/docs/free);
[Cloud Run pricing](https://cloud.google.com/run/pricing) and
[billing requirements](https://docs.cloud.google.com/free/docs/free-cloud-features);
[Oracle's current free-resource allocation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
and [signup FAQ](https://www.oracle.com/cloud/free/faq/);
[current Spaces documentation](https://huggingface.co/docs/hub/en/spaces-overview).

Oracle can reclaim sufficiently idle instances, and free capacity can be
unavailable. Older marketing pages quote a larger A1 allocation; the specific
current resource documentation should govern a new tenancy. The pinned OR-Tools
release has Linux ARM64 wheels for Python 3.11/3.12, making A1 plausible at the
dependency level; an actual deployment still needs testing.
[OR-Tools publisher files](https://pypi.org/project/ortools/9.15.6755/#files)

## Required changes before a hosted beta

1. Use an explicitly configured HTTPS origin in the backend, extension transport
   and manifest. Retain the local mode as an option. Do not grant access to
   arbitrary origins.
2. Authenticate API requests and bind every solve job/result to its user. Add
   per-user quotas and bounded concurrency. CORS is not authentication, and a
   shared key alone is not a multi-user product.
3. Disclose that hosted solving sends selected club-card data to that server.
   Keep credentials, market actions and SBC submission in the EA browser.
   Keep club payloads transient; exclude them from application/access logs.
4. Preserve public catalog snapshots separately from disposable compute.
   Schedule controlled updates and show source age/coverage to users.
5. Explicitly cap OR-Tools workers to allocated CPU and test memory with larger
   pools. Begin with one server worker and one compute job at a time.
6. For Cloud Run, replace the current detached Python thread with an active
   request/stream or a supported durable job system. In-memory polling jobs
   cannot safely scale across instances or rely on idle CPU. Chrome service
   worker fetches also have lifecycle limits; simply increasing a timeout does
   not solve this.

These constraints follow [Cloud Run's execution guidance](https://docs.cloud.google.com/run/docs/tips/general)
and [Chrome's extension service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

For a first hosted trial, provision an available Oracle A1 instance using only
free resources, or build the managed Cloud Run transport with billing monitoring.
Use synthetic data to validate the deployment before connecting an EA club.
Neither option guarantees free, uninterrupted service at arbitrary scale.
