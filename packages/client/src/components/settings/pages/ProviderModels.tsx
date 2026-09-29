import { Star } from 'lucide-react';
import type { ProviderDescriptor, ProviderModel } from '@jam/protocol';
import { Toggle } from '../controls';
import type { ProviderControl } from '../types';
import { toggledFavorite } from '../../composer-model';

/**
 * Which of a provider's models the composer's picker offers, and which are
 * starred to the top (Paper, "Settings v2 · Providers"). Legacy
 * models, the provider's older versions, are listed after the current ones.
 */
export function ProviderModels({
  provider,
  control,
}: {
  provider: ProviderDescriptor;
  control: ProviderControl;
}) {
  const models = provider.models ?? [];
  const favorites = provider.favoriteModels ?? [];
  const hidden = provider.hiddenModels ?? [];
  const shown = models.filter((model) => !hidden.includes(model.id)).length;
  const current = models.filter((model) => !model.legacy);
  const legacy = models.filter((model) => model.legacy);

  const row = (model: ProviderModel) => {
    const starred = favorites.includes(model.id);
    const visible = !hidden.includes(model.id);
    const traits = [model.speeds?.length ? 'Fast' : '', model.efforts?.length ? 'Effort' : '']
      .filter(Boolean)
      .join(' · ');
    return (
      <div key={model.id} className={`sv-model-row ${visible ? '' : 'hidden'}`}>
        <button
          type="button"
          className={`sv-model-star ${starred ? 'on' : ''}`}
          aria-label={`${starred ? 'Unstar' : 'Star'} ${model.label}`}
          aria-pressed={starred}
          onClick={() =>
            void control.configure({
              providerId: provider.id,
              favoriteModels: toggledFavorite(favorites, model.id),
            })
          }
        >
          <Star size={13} fill={starred ? 'currentColor' : 'none'} strokeWidth={1.6} />
        </button>
        <span className="sv-model-name">
          <strong>{model.label}</strong>
          <code>{model.id}</code>
        </span>
        <span className="sv-model-traits">{traits}</span>
        <Toggle
          label={`Show ${model.label} in the model picker`}
          on={visible}
          onChange={(on) =>
            void control.configure({
              providerId: provider.id,
              hiddenModels: on ? hidden.filter((id) => id !== model.id) : [...hidden, model.id],
            })
          }
        />
      </div>
    );
  };

  return (
    <div className="sv-detail-group">
      <div className="sv-model-heading">
        <h3>Models</h3>
        <p>
          Star a model to pin it to the top of the picker. Hidden models stay usable in chats that
          already chose them.
        </p>
        <span>
          {shown} of {models.length} shown
        </span>
      </div>
      <div className="sv-detail-card sv-model-card">
        {current.map(row)}
        {!!legacy.length && (
          <>
            <div className="sv-model-legacy">
              <span>Legacy</span>
              <p>Older versions of a model family. Shown under Legacy in the picker.</p>
            </div>
            {legacy.map(row)}
          </>
        )}
      </div>
    </div>
  );
}
