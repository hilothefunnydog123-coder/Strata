"""Two ways to use Strata. Needs internet (queries live PubMed).

    python examples/usage.py
"""
from strata import ask

QUESTION = "Does metformin reduce cardiovascular mortality in type 2 diabetes?"

# 1) Grounded digest — no model, no API key. Facts come only from the papers.
result = ask(QUESTION, k=6)
print(f"Evidence strength: {result.body.overall_strength}\n")
print(result.answer)

# 2) Synthesised narrative — plug in ANY text-in / text-out model. Strata builds
#    a prompt containing only the retrieved, graded abstracts and instructs the
#    model to cite them and admit uncertainty, so it summarises rather than
#    invents. Uncomment and wire up your provider:
#
# def my_model(prompt: str) -> str:
#     ...  # call OpenAI / Anthropic / a local model, return the text
#
# result = ask(QUESTION, k=6, generate=my_model)
# print(result.answer)
