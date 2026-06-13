const Badge = ({ label, meta, highlighted }) => {
	return (
		<span className="badge" data-tone={ meta.tone }>
			{ highlighted ? <strong>{ label }</strong> : <em>{ label }</em> }
		</span>
	);
};

Badge.templateVars = [
	'label',
	'meta.tone',
	'highlighted',
];

const App = ({ catalog }) => {
	return (
		<main>
			<h1>{ catalog.title }</h1>
			{ catalog.sections.map((section) => (
				<section data-slug={ section.meta.slug }>
					<h2>{ section.heading }</h2>
					{ section.products.map((product) => (
						<article data-sku={ product.details.sku }>
							<h3>{ product.name }</h3>
							{ product.available && (
								<p>{ product.details.manufacturer.name }</p>
							) }
							{ product.featured ? <strong>Featured</strong> : <span>Standard</span> }
							<ul>
								{ product.badges.map((badge) => (
									<li>
										<Badge
											label={ badge.label }
											meta={ badge.meta }
											highlighted={ badge.highlighted }
										/>
									</li>
								)) }
							</ul>
						</article>
					)) }
				</section>
			)) }
		</main>
	);
};

App.templateVars = [
	'catalog.title',
	'catalog.sections[].heading',
	'catalog.sections[].meta.slug',
	'catalog.sections[].products[].name',
	'catalog.sections[].products[].available',
	'catalog.sections[].products[].featured',
	'catalog.sections[].products[].details.sku',
	'catalog.sections[].products[].details.manufacturer.name',
	'catalog.sections[].products[].badges[].label',
	'catalog.sections[].products[].badges[].meta.tone',
	'catalog.sections[].products[].badges[].highlighted',
];

module.exports = { App };
