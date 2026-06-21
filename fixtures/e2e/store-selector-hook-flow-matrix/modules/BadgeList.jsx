export const BadgeList = ({ badges }) => (
	<ul>
		{ badges.map((badge) => (
			<li>{ badge.label }</li>
		)) }
	</ul>
);
