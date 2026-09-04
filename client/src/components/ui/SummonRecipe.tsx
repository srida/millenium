// Le rendu d'UNE recette d'invocation — son coût, puis ses matériels nommés.
//
// ⚠️ Extrait de `TooltipHost` parce que le MENU de choix (`SummonOptionMenu`)
// pose exactement la même question : « qu'est-ce que cette condition demande ? ».
// Le menu affichait auparavant un `label` que `GameController` ne fabrique plus
// depuis que les voies d'invocation ont disparu — ses boutons étaient donc vides
// et le joueur n'avait rien à lire pour choisir. Une règle d'affichage recopiée
// à deux endroits est une règle qu'on corrige à un seul : elle vit ici.
//
// La résolution des noms passe par `data/gameNames` — `data/SummonInfo` est
// pur et ne rend que des ids, c'est l'appelant qui sait les nommer.
import { attributeName, cardName } from '../../data/gameNames.js';
import { recipeCostText, materialsLabel, type SummonRecipe } from '../../data/SummonInfo.js';

/** Les matériels nommés d'une recette, en une ligne. `null` s'il n'y en a pas. */
export function RecipeMaterials({ recipe }: { recipe: SummonRecipe }) {
  if (recipe.requires.length === 0) return null;
  return (
    <div className="mt-0.5 text-[10px] leading-snug text-white/55">
      <span className="text-white/40">{materialsLabel(recipe)} : </span>
      {recipe.requires.map((m, i) => (
        <span key={`${m.id}-${i}`}>
          {i > 0 && <span className="text-white/30"> + </span>}
          {m.kind === 'attribute'
            // Un matériel d'attribut n'est pas une carte : n'importe quelle
            // unité qui le porte convient. Le dire, sinon le joueur cherche
            // une carte de ce nom.
            // « tout porteur de X » plutôt que « tout X » : le nom d'un
            // attribut n'a ni genre ni nombre fixes (Yeux Bleus, Dragon…),
            // la tournure impersonnelle s'accorde donc toujours.
            ? <span className="text-tier-4">tout porteur de {attributeName(m.id)}</span>
            : <span className="text-player">{cardName(m.id)}</span>}
        </span>
      ))}
    </div>
  );
}

/** Une recette entière : le coût EST le titre, il n'y a plus de voie à nommer. */
export default function RecipeRow({ recipe }: { recipe: SummonRecipe }) {
  const cost = recipeCostText(recipe);
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[11px] font-bold tabular-nums text-white/85">
          {cost ?? 'Se pose directement'}
        </span>
      </div>
      <RecipeMaterials recipe={recipe} />
    </div>
  );
}
