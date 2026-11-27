import mlx.core as mx
from mflux.models.flux.model.flux_transformer.common.attention_utils import AttentionUtils


def install_chunked_attention():
    original = AttentionUtils.compute_attention

    def compute_attention(*, query, key, value, batch_size, num_heads, head_dim, mask=None):
        assert mask is None
        chunks = []
        for offset in range(0, query.shape[2], 512):
            chunk = original(query=query[:, :, offset:offset + 512], key=key, value=value, batch_size=batch_size, num_heads=num_heads, head_dim=head_dim)
            mx.eval(chunk)
            chunks.append(chunk)
        return mx.concatenate(chunks, axis=1)

    AttentionUtils.compute_attention = staticmethod(compute_attention)
