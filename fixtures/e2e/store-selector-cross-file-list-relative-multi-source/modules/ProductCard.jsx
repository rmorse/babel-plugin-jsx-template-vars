export const ProductCard = ({ product, badges }) => (
	<article>
		<h2>{ product.name }</h2>
		<ul>
			{ badges.map((badge) => (
				<li>{ badge.label }</li>
			)) }
		</ul>
	</article>
);
