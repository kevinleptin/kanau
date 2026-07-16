using System.Text.Json;
using Kanau.Application;
using Kanau.Domain;
using Kanau.Infrastructure.Ai.Prompts;
using Kanau.Infrastructure.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kanau.Api.Controllers;

public record CreateNoteRequest(Guid CaptureId);
public record TaggingResult(string NoteType, List<string> Tags);

[Route("api/notes")]
public class NotesController(KanauDbContext db, IAiGateway ai) : KanauControllerBase
{
    /// <summary>从 CaptureItem 创建速记（自动打标异步进行，先落库）。</summary>
    [HttpPost]
    public async Task<ActionResult> Create(CreateNoteRequest req)
    {
        var cap = await db.CaptureItems.FirstOrDefaultAsync(c => c.Id == req.CaptureId && c.UserId == UserId);
        if (cap == null) return NotFound(new { message = "输入记录不存在" });
        var note = new Note { Id = Guid.NewGuid(), UserId = UserId, CaptureId = cap.Id };
        db.Notes.Add(note);
        await db.SaveChangesAsync();

        // 若已有文本，同步打标 + 灵感连接（家庭量级，同步开销可接受）
        if (!string.IsNullOrWhiteSpace(cap.CorrectedText))
        {
            await TagAsync(note, cap.CorrectedText!);
            await LinkDreamsAsync(note, cap);
        }
        return Ok(await ToDtoAsync(note));
    }

    private async Task TagAsync(Note note, string text)
    {
        try
        {
            var r = await ai.ChatJsonAsync<TaggingResult>(AiTaskType.Tagging, UserId,
                PromptTemplates.TaggingSystem, text);
            if (r != null)
            {
                if (Enum.TryParse<NoteType>(r.NoteType, true, out var nt)) note.NoteType = nt;
                note.Tags = JsonSerializer.Serialize(r.Tags ?? []);
                await db.SaveChangesAsync();
            }
        }
        catch { /* 打标失败不阻塞速记 */ }
    }

    /// <summary>灵感连接：与现有梦想做向量相似度匹配。</summary>
    private async Task LinkDreamsAsync(Note note, CaptureItem cap)
    {
        if (cap.Embedding == null) return;
        var noteVec = JsonSerializer.Deserialize<float[]>(cap.Embedding);
        if (noteVec == null) return;

        var dreams = await db.Dreams
            .Where(d => d.UserId == UserId && d.Status == DreamStatus.Active).ToListAsync();
        foreach (var dream in dreams)
        {
            var text = dream.QuantifiedText ?? dream.Title;
            var dreamVec = await ai.EmbedAsync(UserId, text);
            if (dreamVec == null) continue;
            var score = Cosine(noteVec, dreamVec);
            if (score >= 0.75)
            {
                db.NoteDreamLinks.Add(new NoteDreamLink
                {
                    Id = Guid.NewGuid(), NoteId = note.Id, DreamId = dream.Id, Score = Math.Round(score, 4)
                });
            }
        }
        await db.SaveChangesAsync();
    }

    [HttpGet]
    public async Task<ActionResult> List(int page = 1, int pageSize = 20, NoteType? type = null)
    {
        var q = db.Notes.Where(n => n.UserId == UserId);
        if (type != null) q = q.Where(n => n.NoteType == type);
        var total = await q.CountAsync();
        var notes = await q.OrderByDescending(n => n.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var dtos = new List<object>();
        foreach (var n in notes) dtos.Add(await ToDtoAsync(n));
        return Ok(new { total, items = dtos });
    }

    /// <summary>语义搜索：自然语言 → Embedding → 余弦相似度（应用层）。</summary>
    [HttpGet("search")]
    public async Task<ActionResult> Search(string q, int limit = 10)
    {
        if (string.IsNullOrWhiteSpace(q)) return BadRequest();
        var queryVec = await ai.EmbedAsync(UserId, q);

        var notes = await (
            from n in db.Notes
            join c in db.CaptureItems on n.CaptureId equals c.Id
            where n.UserId == UserId && c.CorrectedText != null
            select new { n, c }).ToListAsync();

        // 向量可用 → 语义排序；否则退化为关键词
        List<object> results;
        if (queryVec != null)
        {
            results = notes
                .Select(x => new
                {
                    x.n, x.c,
                    score = x.c.Embedding == null ? -1
                        : Cosine(queryVec, JsonSerializer.Deserialize<float[]>(x.c.Embedding)!)
                })
                .Where(x => x.score > 0.3 || (x.score < 0 && x.c.CorrectedText!.Contains(q)))
                .OrderByDescending(x => x.score)
                .Take(limit)
                .Select(x => (object)new { note = ToDtoSync(x.n, x.c), score = Math.Round(Math.Max(x.score, 0), 4) })
                .ToList();
        }
        else
        {
            results = notes.Where(x => x.c.CorrectedText!.Contains(q)).Take(limit)
                .Select(x => (object)new { note = ToDtoSync(x.n, x.c), score = 0.0 }).ToList();
        }
        return Ok(results);
    }

    /// <summary>确认/忽略灵感连接。</summary>
    [HttpPost("links/{linkId:guid}/confirm")]
    public async Task<ActionResult> ConfirmLink(Guid linkId, [FromBody] bool confirmed)
    {
        var link = await db.NoteDreamLinks
            .Join(db.Notes, l => l.NoteId, n => n.Id, (l, n) => new { l, n })
            .Where(x => x.l.Id == linkId && x.n.UserId == UserId)
            .Select(x => x.l).FirstOrDefaultAsync();
        if (link == null) return NotFound();
        if (confirmed) link.Confirmed = true;
        else db.NoteDreamLinks.Remove(link);
        await db.SaveChangesAsync();
        return Ok();
    }

    [HttpDelete("{id:guid}")]
    public async Task<ActionResult> Delete(Guid id)
    {
        var n = await db.Notes.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (n == null) return NotFound();
        db.Notes.Remove(n);
        await db.SaveChangesAsync();
        return Ok();
    }

    private async Task<object> ToDtoAsync(Note n)
    {
        var cap = await db.CaptureItems.FindAsync(n.CaptureId);
        var links = await db.NoteDreamLinks.Where(l => l.NoteId == n.Id).ToListAsync();
        return new
        {
            n.Id, n.CaptureId, noteType = n.NoteType.ToString().ToLowerInvariant(),
            tags = n.Tags == null ? [] : JsonSerializer.Deserialize<List<string>>(n.Tags),
            text = cap?.CorrectedText, capture = cap == null ? null : CapturesController.ToDto(cap),
            links = links.Select(l => new { l.Id, l.DreamId, l.Score, l.Confirmed }),
            n.CreatedAt
        };
    }

    private static object ToDtoSync(Note n, CaptureItem c) => new
    {
        n.Id, n.CaptureId, noteType = n.NoteType.ToString().ToLowerInvariant(),
        tags = n.Tags == null ? [] : JsonSerializer.Deserialize<List<string>>(n.Tags),
        text = c.CorrectedText, c.ResolvedAddress, n.CreatedAt
    };

    internal static double Cosine(float[] a, float[] b)
    {
        if (a.Length != b.Length || a.Length == 0) return -1;
        double dot = 0, na = 0, nb = 0;
        for (var i = 0; i < a.Length; i++)
        {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        return na == 0 || nb == 0 ? -1 : dot / (Math.Sqrt(na) * Math.Sqrt(nb));
    }
}
